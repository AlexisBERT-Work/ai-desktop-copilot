//! Thread d'écoute : micro → rééchantillonnage 16 kHz → VAD → STT.
//!
//! Un tour = une prise de parole. Dès que le VAD la clôt (0,7 s de silence),
//! le micro est fermé, Parakeet transcrit, et `voice:transcript` part vers
//! l'UI qui l'envoie au modèle comme un message tapé. Si personne ne parle
//! pendant [`NO_SPEECH_TIMEOUT`], on rend la main sans rien dire.
//!
//! La dictée (raccourci maintenu) suit un autre chemin : le micro s'ouvre
//! **avant** le chargement des modèles (l'audio attend dans le canal), tout
//! est gardé brut jusqu'au relâchement — pas de fin de tour au silence, pas de
//! délai sans parole, plafond [`MAX_DICTATION`] — puis un VAD dédié découpe
//! l'enregistrement, Parakeet transcrit chaque prise, et un thread à part tape
//! le texte ([`super::dictation`]) pour ne pas bloquer l'écoute.

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::json;
use sherpa_onnx::{LinearResampler, VoiceActivityDetector};
use tauri::{AppHandle, Emitter};
use tracing::{info, warn};

use super::capture::{self, MicStream};
use super::dictation::{self, DictationEvent, DictationPhase, Outcome, Report, Target};
use super::machine::{self, Action, Input, VoiceState};
use super::stt::Recognizer;
use super::{set_state, vad, ListenerCommand, Shared};
use crate::core::audit;
use crate::core::error::CatdeskError;
use crate::ipc::protocol::{EVENT_VOICE_DICTATION, EVENT_VOICE_LEVEL, EVENT_VOICE_TRANSCRIPT};

/// Sans parole détectée dans ce délai, l'écoute s'arrête d'elle-même.
const NO_SPEECH_TIMEOUT: Duration = Duration::from_secs(8);
/// Cadence du niveau micro envoyé à l'UI (halo du bouton).
const LEVEL_PERIOD: Duration = Duration::from_millis(66);
const TICK: Duration = Duration::from_millis(20);
/// Plafond d'une dictée : au-delà, on transcrit ce qu'on a (touche coincée,
/// ou oubliée). Le VAD de dictée tient [`vad::DICTATION_BUFFER_S`].
const MAX_DICTATION: Duration = Duration::from_secs(60);

struct Engines {
    vad: VoiceActivityDetector,
    dictation_vad: VoiceActivityDetector,
    stt: Recognizer,
}

/// Dictée en cours : audio brut à 16 kHz jusqu'au relâchement.
struct Recording {
    mic: Mic,
    samples: Vec<f32>,
    target: Target,
}

/// Mesures d'une dictée, pour l'audit (jamais le texte).
#[derive(Clone, Copy)]
struct Timing {
    released_at: Instant,
    audio_ms: u64,
    stt_ms: u64,
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
    let mut recording: Option<Recording> = None;

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
            Ok(ListenerCommand::DictateStart(target)) => {
                dictate_start(&app, &shared, &mut mic, &mut recording, target);
                // Chargement pendant que l'utilisateur parle : le micro est
                // déjà ouvert, son audio attend dans le canal.
                if recording.is_some() {
                    if let Err(e) = ensure_engines(&shared, &mut engines) {
                        info!("voice: modèles de dictée non chargés ({e})");
                    }
                }
            }
            Ok(ListenerCommand::DictateEnd(released_at)) => {
                dictate_end(&app, &shared, &mut engines, &mut recording, released_at);
            }
            Err(RecvTimeoutError::Timeout) => {
                if let (Some(m), Some(e)) = (mic.as_mut(), engines.as_ref()) {
                    if pump(&app, &shared, m, e) {
                        mic = None;
                    }
                }
                if let Some(r) = recording.as_mut() {
                    if record(&app, r) {
                        info!("voice: dictée plafonnée à 60 s, transcription");
                        dictate_end(&app, &shared, &mut engines, &mut recording, Instant::now());
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
    let dictation_vad = vad::create_for_dictation(&paths)
        .ok_or_else(|| CatdeskError::Audio("chargement du VAD de dictée".into()))?;
    let stt = Recognizer::create(&paths)
        .ok_or_else(|| CatdeskError::Audio("chargement de Parakeet".into()))?;
    info!(
        "voice: VAD + Parakeet chargés en {:.1} s",
        started.elapsed().as_secs_f32()
    );
    *engines = Some(Engines {
        vad,
        dictation_vad,
        stt,
    });
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

// ─── Dictée ──────────────────────────────────────────────────────────────

fn emit_dictation(app: &AppHandle, phase: DictationPhase, outcome: Option<Outcome>, chars: usize) {
    let event = DictationEvent {
        phase,
        outcome,
        chars,
    };
    if let Err(e) = app.emit(EVENT_VOICE_DICTATION, event) {
        warn!("voice: impossible d'émettre l'état de la dictée ({e})");
    }
}

fn dictate_start(
    app: &AppHandle,
    shared: &Arc<Mutex<Shared>>,
    mic: &mut Option<Mic>,
    recording: &mut Option<Recording>,
    target: Target,
) {
    // Vérification de fichiers seulement (le chargement vient après
    // l'ouverture du micro) : sans modèles, inutile d'ouvrir quoi que ce soit.
    if shared
        .lock()
        .expect("voice shared lock")
        .models
        .stt()
        .is_none()
    {
        emit_dictation(app, DictationPhase::Done, Some(Outcome::NoModels), 0);
        return;
    }
    let (state, actions) = transition(app, shared, Input::DictateStart);
    if actions.contains(&Action::CloseMic) {
        *mic = None; // la bulle écoutait : son tour est abandonné
    }
    if !actions.contains(&Action::OpenMic) {
        if state == VoiceState::Transcribing {
            emit_dictation(app, DictationPhase::Done, Some(Outcome::Busy), 0);
        }
        return; // appui répété pendant la dictée, ou bulle occupée
    }
    match open_mic() {
        Ok(m) => {
            *recording = Some(Recording {
                mic: m,
                samples: Vec::with_capacity(vad::SAMPLE_RATE as usize * 10),
                target,
            });
            emit_dictation(app, DictationPhase::Recording, None, 0);
        }
        Err(e) => {
            warn!("voice: micro indisponible pour la dictée ({e})");
            transition(app, shared, Input::DictateCancel);
            emit_dictation(app, DictationPhase::Done, Some(Outcome::MicError), 0);
        }
    }
}

/// Verse l'audio en attente dans l'enregistrement et publie le niveau.
/// `true` quand le plafond de durée est atteint.
fn record(app: &AppHandle, rec: &mut Recording) -> bool {
    let mut level = 0.0f32;
    while let Ok(chunk) = rec.mic.rx.try_recv() {
        level = level.max(capture::rms(&chunk));
        match &rec.mic.resampler {
            Some(r) => rec.samples.extend(r.resample(&chunk, false)),
            None => rec.samples.extend(chunk),
        }
    }
    if rec.mic.last_level_at.elapsed() >= LEVEL_PERIOD {
        rec.mic.last_level_at = Instant::now();
        let _ = app.emit(EVENT_VOICE_LEVEL, json!({ "rms": level }));
    }
    rec.mic.opened_at.elapsed() >= MAX_DICTATION
}

fn dictate_end(
    app: &AppHandle,
    shared: &Arc<Mutex<Shared>>,
    engines: &mut Option<Engines>,
    recording: &mut Option<Recording>,
    released_at: Instant,
) {
    let (_, actions) = transition(app, shared, Input::DictateEnd);
    if !actions.contains(&Action::RunStt) {
        return; // l'appui avait été ignoré (bulle occupée, modèles absents)
    }
    let Some(mut rec) = recording.take() else {
        transition(app, shared, Input::DictationReady);
        emit_dictation(app, DictationPhase::Done, Some(Outcome::Empty), 0);
        return;
    };
    // CloseMic : dernier audio versé, puis le flux est lâché.
    record(app, &mut rec);
    let Recording {
        mic,
        samples,
        target,
    } = rec;
    drop(mic);
    emit_dictation(app, DictationPhase::Transcribing, None, 0);

    let audio_ms = samples.len() as u64 * 1000 / vad::SAMPLE_RATE as u64;
    let started = Instant::now();
    let transcript = ensure_engines(shared, engines).map(|()| match engines.as_ref() {
        Some(e) => transcribe_dictation(e, &samples),
        None => String::new(),
    });
    let timing = Timing {
        released_at,
        audio_ms,
        stt_ms: started.elapsed().as_millis() as u64,
    };
    let (_, actions) = transition(app, shared, Input::DictationReady);
    match transcript {
        Ok(text) if actions.contains(&Action::InsertText) => {
            spawn_insert(app.clone(), text, target, timing)
        }
        Ok(_) => finish(app, report(Outcome::Empty, 0), timing),
        Err(e) => {
            warn!("voice: dictée non transcrite ({e})");
            finish(app, report(Outcome::NoModels, 0), timing);
        }
    }
}

fn report(outcome: Outcome, chars: usize) -> Report {
    Report {
        outcome,
        chars,
        wait_ms: 0,
    }
}

/// VAD de dictée sur l'enregistrement entier, Parakeet sur chaque prise.
fn transcribe_dictation(engines: &Engines, samples: &[f32]) -> String {
    let segments = vad::segments(&engines.dictation_vad, samples);
    dictation::join_segments(segments.iter().map(|s| engines.stt.transcribe(s)))
}

/// L'insertion attend le relâchement de Ctrl/Alt (jusqu'à 5 s) : hors du
/// thread d'écoute, qui doit rester disponible pour la bulle.
fn spawn_insert(app: AppHandle, text: String, target: Target, timing: Timing) {
    let fallback = app.clone();
    let spawned = std::thread::Builder::new()
        .name("catdesk-dictation".into())
        .spawn(move || {
            let report = dictation::insert(&text, target);
            finish(&app, report, timing);
        });
    if let Err(e) = spawned {
        warn!("voice: thread d'insertion impossible ({e})");
        finish(&fallback, report(Outcome::Blocked, 0), timing);
    }
}

/// Fin d'une dictée qui a ouvert le micro : journal, audit, pastille.
fn finish(app: &AppHandle, report: Report, timing: Timing) {
    let ms = timing.released_at.elapsed().as_millis() as u64;
    let wait_ms = report.wait_ms as u64;
    info!(
        outcome = report.outcome.as_str(),
        chars = report.chars,
        ms,
        audio_ms = timing.audio_ms,
        stt_ms = timing.stt_ms,
        wait_ms,
        "voice: dictée"
    );
    // Jamais le texte : une dictée peut viser un message privé ou un mot de passe.
    audit::log(
        "VOICE_DICTATE",
        json!({
            "outcome": report.outcome,
            "chars": report.chars,
            "ms": ms,
            "audioMs": timing.audio_ms,
            "sttMs": timing.stt_ms,
            "waitMs": wait_ms,
        }),
    );
    emit_dictation(
        app,
        DictationPhase::Done,
        Some(report.outcome),
        report.chars,
    );
}
