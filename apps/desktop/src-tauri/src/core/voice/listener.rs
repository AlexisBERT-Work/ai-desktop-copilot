//! Thread d'écoute : micro → rééchantillonnage 16 kHz → VAD → STT.
//!
//! Un tour = une prise de parole. Dès que le VAD la clôt (0,7 s de silence),
//! le micro est fermé, Parakeet transcrit, et `voice:transcript` part vers
//! l'UI qui l'envoie au modèle comme un message tapé. Si personne ne parle
//! pendant [`NO_SPEECH_TIMEOUT`], on rend la main sans rien dire.

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sherpa_onnx::{LinearResampler, VoiceActivityDetector};
use tauri::{AppHandle, Emitter};
use tracing::{info, warn};

use super::capture::{self, MicStream};
use super::machine::{self, Action, Input, VoiceState};
use super::stt::Recognizer;
use super::{set_state, vad, ListenerCommand, Shared};
use crate::core::error::CatdeskError;
use crate::ipc::protocol::{EVENT_VOICE_LEVEL, EVENT_VOICE_TRANSCRIPT};

/// Sans parole détectée dans ce délai, l'écoute s'arrête d'elle-même.
const NO_SPEECH_TIMEOUT: Duration = Duration::from_secs(8);
/// Cadence du niveau micro envoyé à l'UI (halo du bouton).
const LEVEL_PERIOD: Duration = Duration::from_millis(66);
const TICK: Duration = Duration::from_millis(20);

struct Engines {
    vad: VoiceActivityDetector,
    stt: Recognizer,
}

struct Mic {
    _stream: MicStream,
    rx: Receiver<Vec<f32>>,
    /// `None` quand le micro est déjà à 16 kHz.
    resampler: Option<LinearResampler>,
    opened_at: Instant,
    speech_seen: bool,
    last_level_at: Instant,
}

pub fn spawn(app: AppHandle, shared: Arc<Mutex<Shared>>) -> Sender<ListenerCommand> {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("catdesk-voice-listener".into())
        .spawn(move || run(app, shared, rx))
        .expect("spawn voice listener");
    tx
}

fn run(app: AppHandle, shared: Arc<Mutex<Shared>>, rx: Receiver<ListenerCommand>) {
    let mut engines: Option<Engines> = None;
    let mut mic: Option<Mic> = None;

    loop {
        match rx.recv_timeout(TICK) {
            Ok(ListenerCommand::Start(reply)) => {
                let result = start(&app, &shared, &mut engines, &mut mic);
                let _ = reply.send(result.map_err(String::from));
            }
            Ok(ListenerCommand::Stop) => {
                let (_, actions) = transition(&app, &shared, Input::ListenStop);
                if actions.contains(&Action::CloseMic) {
                    mic = None;
                }
            }
            Ok(ListenerCommand::Warmup) => {
                if let Err(e) = ensure_engines(&shared, &mut engines) {
                    info!("voice: préchauffage STT impossible ({e})");
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if let (Some(m), Some(e)) = (mic.as_mut(), engines.as_ref()) {
                    if pump(&app, &shared, m, e) {
                        mic = None;
                    }
                }
            }
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

fn transition(
    app: &AppHandle,
    shared: &Arc<Mutex<Shared>>,
    input: Input,
) -> (VoiceState, Vec<Action>) {
    let current = shared.lock().expect("voice shared lock").state;
    let (next, actions) = machine::step(current, input);
    set_state(app, shared, next);
    (next, actions)
}

fn ensure_engines(
    shared: &Arc<Mutex<Shared>>,
    engines: &mut Option<Engines>,
) -> Result<(), CatdeskError> {
    if engines.is_some() {
        return Ok(());
    }
    let paths = shared
        .lock()
        .expect("voice shared lock")
        .models
        .stt()
        .ok_or_else(|| {
            CatdeskError::Refused(
                "Modèles de reconnaissance vocale absents (dossier voice/)".into(),
            )
        })?;
    let started = Instant::now();
    let vad = vad::create(&paths)
        .ok_or_else(|| CatdeskError::Audio("chargement du VAD Silero".into()))?;
    let stt = Recognizer::create(&paths)
        .ok_or_else(|| CatdeskError::Audio("chargement de Parakeet".into()))?;
    info!(
        "voice: VAD + Parakeet chargés en {:.1} s",
        started.elapsed().as_secs_f32()
    );
    *engines = Some(Engines { vad, stt });
    Ok(())
}

fn start(
    app: &AppHandle,
    shared: &Arc<Mutex<Shared>>,
    engines: &mut Option<Engines>,
    mic: &mut Option<Mic>,
) -> Result<(), CatdeskError> {
    ensure_engines(shared, engines)?;
    let (_, actions) = transition(app, shared, Input::ListenStart);
    if !actions.contains(&Action::OpenMic) {
        return Ok(()); // déjà en train d'écouter ou de transcrire
    }
    match open_mic() {
        Ok(m) => {
            if let Some(e) = engines.as_ref() {
                e.vad.reset();
                e.vad.clear();
            }
            *mic = Some(m);
            Ok(())
        }
        Err(e) => {
            // Retour à l'état de départ : l'UI a reçu « listening » entre-temps.
            transition(app, shared, Input::ListenStop);
            Err(e)
        }
    }
}

fn open_mic() -> Result<Mic, CatdeskError> {
    let (tx, rx) = mpsc::channel();
    let stream = capture::open(tx)?;
    let resampler = if stream.sample_rate as i32 == vad::SAMPLE_RATE {
        None
    } else {
        Some(
            LinearResampler::create(stream.sample_rate as i32, vad::SAMPLE_RATE)
                .ok_or_else(|| CatdeskError::Audio("rééchantillonnage micro".into()))?,
        )
    };
    let now = Instant::now();
    Ok(Mic {
        _stream: stream,
        rx,
        resampler,
        opened_at: now,
        speech_seen: false,
        last_level_at: now,
    })
}

/// Consomme l'audio en attente. Renvoie `true` quand le micro doit être fermé
/// (prise de parole obtenue, ou silence trop long).
fn pump(app: &AppHandle, shared: &Arc<Mutex<Shared>>, mic: &mut Mic, engines: &Engines) -> bool {
    let mut level = 0.0f32;
    while let Ok(chunk) = mic.rx.try_recv() {
        level = level.max(capture::rms(&chunk));
        let samples = match &mic.resampler {
            Some(r) => r.resample(&chunk, false),
            None => chunk,
        };
        engines.vad.accept_waveform(&samples);
    }
    if engines.vad.detected() {
        mic.speech_seen = true;
    }
    if mic.last_level_at.elapsed() >= LEVEL_PERIOD {
        mic.last_level_at = Instant::now();
        let _ = app.emit(EVENT_VOICE_LEVEL, serde_json::json!({ "rms": level }));
    }

    if let Some(segment) = engines.vad.front() {
        let samples = segment.samples().to_vec();
        drop(segment);
        engines.vad.clear();
        engines.vad.reset();

        let (_, actions) = transition(app, shared, Input::SegmentReady);
        if actions.contains(&Action::RunStt) {
            let started = Instant::now();
            let text = engines.stt.transcribe(&samples);
            info!(
                "voice: {:.1} s de parole transcrits en {} ms : {text:?}",
                samples.len() as f32 / vad::SAMPLE_RATE as f32,
                started.elapsed().as_millis()
            );
            let (_, actions) = transition(app, shared, Input::TranscriptReady);
            if actions.contains(&Action::EmitTranscript) {
                if let Err(e) = app.emit(
                    EVENT_VOICE_TRANSCRIPT,
                    serde_json::json!({ "text": text, "final": true }),
                ) {
                    warn!("voice: impossible d'émettre la transcription ({e})");
                }
            }
        }
        return true;
    }

    if !mic.speech_seen && mic.opened_at.elapsed() >= NO_SPEECH_TIMEOUT {
        info!("voice: rien entendu, écoute arrêtée");
        transition(app, shared, Input::NoSpeechTimeout);
        return true;
    }
    false
}
