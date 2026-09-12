//! Thread de parole : file de phrases → Piper → haut-parleurs.
//!
//! L'UI envoie chaque phrase dès qu'elle est complète dans le flux de tokens ;
//! la phrase N+1 se synthétise pendant que la N joue. Couper = vider la file
//! et le tampon, et lever `stop_flag`, que le rappel de synthèse consulte à
//! chaque morceau pour abandonner une phrase en cours.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sherpa_onnx::LinearResampler;
use tauri::AppHandle;
use tracing::{info, warn};

use super::machine::{self, Action, Input, VoiceState};
use super::playback::Player;
use super::tts::Synthesizer;
use super::{set_state, Shared, SpeakerCommand, VoiceConfig};
use crate::core::error::CatdeskError;

const TICK: Duration = Duration::from_millis(30);
/// File vide, lecture finie, et toujours pas de fin de tour : l'UI a
/// probablement perdu le fil (erreur, rechargement). On clôt tout seul.
const END_OF_TURN_GRACE: Duration = Duration::from_secs(30);

/// La réponse en cours : ses phrases à dire, et si l'UI a annoncé la fin.
#[derive(Default)]
struct Turn {
    queue: VecDeque<String>,
    ended: bool,
    /// Depuis quand il n'y a plus rien à dire ni à jouer.
    silent_since: Option<Instant>,
}

impl Turn {
    fn clear(&mut self) {
        self.queue.clear();
        self.ended = false;
        self.silent_since = None;
    }
}

struct Engine {
    synth: Synthesizer,
    /// Voix chargée — pour recharger quand le réglage change.
    voice: String,
    player: Player,
    /// Piper sort du 22,05 kHz, la carte son veut en général 48 kHz.
    resampler: Option<Arc<LinearResampler>>,
}

pub fn spawn(
    app: AppHandle,
    shared: Arc<Mutex<Shared>>,
    stop_flag: Arc<AtomicBool>,
) -> Sender<SpeakerCommand> {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("catdesk-voice-speaker".into())
        .spawn(move || run(app, shared, stop_flag, rx))
        .expect("spawn voice speaker");
    tx
}

fn run(
    app: AppHandle,
    shared: Arc<Mutex<Shared>>,
    stop_flag: Arc<AtomicBool>,
    rx: Receiver<SpeakerCommand>,
) {
    let mut engine: Option<Engine> = None;
    let mut turn = Turn::default();

    loop {
        match rx.recv_timeout(TICK) {
            Ok(SpeakerCommand::Speak(text)) => {
                let (_, actions) = transition(&app, &shared, Input::SpeakRequested);
                if actions.contains(&Action::DropSentence) {
                    info!("voice: phrase ignorée, l'utilisateur parle");
                } else {
                    turn.queue.push_back(text);
                    turn.ended = false;
                    turn.silent_since = None;
                }
            }
            Ok(SpeakerCommand::EndOfTurn) => turn.ended = true,
            Ok(SpeakerCommand::Stop) => {
                let (_, actions) = transition(&app, &shared, Input::SpeakStop);
                if actions.contains(&Action::StopPlayback) {
                    turn.clear();
                    if let Some(e) = &engine {
                        e.player.clear();
                    }
                }
                stop_flag.store(false, Ordering::SeqCst);
            }
            Ok(SpeakerCommand::Configure(config)) => configure(&shared, &mut engine, config),
            Ok(SpeakerCommand::Warmup) => {
                if let Err(e) = ensure_engine(&shared, &mut engine) {
                    info!("voice: préchauffage TTS impossible ({e})");
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                pump(&app, &shared, &stop_flag, &mut engine, &mut turn);
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

fn configure(shared: &Arc<Mutex<Shared>>, engine: &mut Option<Engine>, config: VoiceConfig) {
    let voice_changed = engine.as_ref().is_some_and(|e| e.voice != config.voice);
    shared.lock().expect("voice shared lock").config = config;
    if voice_changed {
        // Rechargée à la prochaine phrase, avec la nouvelle voix.
        *engine = None;
    }
}

fn ensure_engine(
    shared: &Arc<Mutex<Shared>>,
    engine: &mut Option<Engine>,
) -> Result<(), CatdeskError> {
    if engine.is_some() {
        return Ok(());
    }
    let (voice, paths) = {
        let s = shared.lock().expect("voice shared lock");
        let paths = s.models.piper(&s.config.voice).ok_or_else(|| {
            CatdeskError::Refused(format!(
                "Voix « {} » introuvable (dossier voice/)",
                s.config.voice
            ))
        })?;
        (s.config.voice.clone(), paths)
    };
    let started = Instant::now();
    let synth = Synthesizer::create(&paths)
        .ok_or_else(|| CatdeskError::Audio("chargement de Piper".into()))?;
    let player = Player::open()?;
    let resampler = if synth.sample_rate() == player.sample_rate as i32 {
        None
    } else {
        Some(Arc::new(
            LinearResampler::create(synth.sample_rate(), player.sample_rate as i32)
                .ok_or_else(|| CatdeskError::Audio("rééchantillonnage sortie".into()))?,
        ))
    };
    info!(
        "voice: Piper « {voice} » ({} Hz → {} Hz) prêt en {} ms",
        synth.sample_rate(),
        player.sample_rate,
        started.elapsed().as_millis()
    );
    *engine = Some(Engine {
        synth,
        voice,
        player,
        resampler,
    });
    Ok(())
}

/// Synthétise la prochaine phrase, ou constate la fin du tour.
fn pump(
    app: &AppHandle,
    shared: &Arc<Mutex<Shared>>,
    stop_flag: &Arc<AtomicBool>,
    engine: &mut Option<Engine>,
    turn: &mut Turn,
) {
    let speaking = shared.lock().expect("voice shared lock").state == VoiceState::Speaking;
    if !speaking {
        // Plus notre tour (l'utilisateur a repris la main) : rien ne doit
        // rester à dire pour la prochaine fois.
        turn.clear();
        return;
    }

    let Some(text) = turn.queue.pop_front() else {
        let drained = engine.as_ref().map_or(true, |e| e.player.pending() == 0);
        if !drained {
            turn.silent_since = None;
            return;
        }
        let silent_since = *turn.silent_since.get_or_insert_with(Instant::now);
        if turn.ended || silent_since.elapsed() >= END_OF_TURN_GRACE {
            if !turn.ended {
                warn!("voice: fin de tour jamais reçue, clôture automatique");
            }
            turn.clear();
            transition(app, shared, Input::SpeechFinished);
        }
        return;
    };
    turn.silent_since = None;

    if let Err(e) = ensure_engine(shared, engine) {
        warn!("voice: synthèse impossible ({e})");
        turn.clear();
        transition(app, shared, Input::SpeechFinished);
        return;
    }
    let Some(eng) = engine.as_ref() else { return };

    let speed = shared.lock().expect("voice shared lock").config.speed;
    let sink = eng.player.sink();
    let resampler = eng.resampler.clone();
    let stop = stop_flag.clone();
    let started = Instant::now();
    eng.synth
        .synthesize(&text, speed, move |chunk: &[f32], _progress| {
            if stop.load(Ordering::SeqCst) {
                return false;
            }
            let out = match &resampler {
                Some(r) => r.resample(chunk, true),
                None => chunk.to_vec(),
            };
            sink.lock().expect("player buffer").extend(out);
            true
        });
    info!(
        "voice: « {} » synthétisée en {} ms",
        text.chars().take(40).collect::<String>(),
        started.elapsed().as_millis()
    );
}
