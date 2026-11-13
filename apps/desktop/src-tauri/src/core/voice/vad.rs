//! Détection de parole (Silero VAD via sherpa-onnx) : découpe le flux micro en
//! prises de parole, et décide de la fin de tour au silence.
//!
//! Deux réglages : la bulle (fin de tour à 0,7 s de silence, en direct) et la
//! dictée (enregistrement complet découpé d'un coup au relâchement).

use sherpa_onnx::{SileroVadModelConfig, VadModelConfig, VoiceActivityDetector};

use super::models::SttPaths;

/// Fréquence d'échantillonnage imposée par Silero et Parakeet.
pub const SAMPLE_RATE: i32 = 16_000;
/// Fenêtre d'analyse de Silero, en échantillons.
const WINDOW: usize = 512;
/// Silence qui clôt un tour de parole. 0,7 s laisse respirer une phrase sans
/// couper au premier « euh ».
const MIN_SILENCE_S: f32 = 0.7;
/// En dessous, ce n'est pas de la parole (un clic, une toux).
const MIN_SPEECH_S: f32 = 0.25;
/// Garde-fou : une consigne à un assistant ne dure pas 15 s.
const MAX_SPEECH_S: f32 = 15.0;
/// Tampon interne du VAD, en secondes — doit contenir la plus longue prise.
const BUFFER_S: f32 = 30.0;

/// Dictée : seule une vraie pause (1 s) coupe — Parakeet ponctue mieux une
/// phrase entière que des bouts.
const DICTATION_MIN_SILENCE_S: f32 = 1.0;
/// Au-delà, Silero cherche une coupure (seuil relevé) : Parakeet garde des
/// segments courts, donc rapides.
const DICTATION_MAX_SPEECH_S: f32 = 20.0;
/// Doit contenir tout l'enregistrement (plafond de 60 s) d'un coup.
pub const DICTATION_BUFFER_S: f32 = 65.0;

fn config(paths: &SttPaths, min_silence: f32, max_speech: f32) -> VadModelConfig {
    VadModelConfig {
        silero_vad: SileroVadModelConfig {
            model: Some(paths.vad.display().to_string()),
            threshold: 0.5,
            min_silence_duration: min_silence,
            min_speech_duration: MIN_SPEECH_S,
            window_size: WINDOW as i32,
            max_speech_duration: max_speech,
        },
        sample_rate: SAMPLE_RATE,
        num_threads: 1,
        provider: Some("cpu".into()),
        ..Default::default()
    }
}

pub fn create(paths: &SttPaths) -> Option<VoiceActivityDetector> {
    VoiceActivityDetector::create(&config(paths, MIN_SILENCE_S, MAX_SPEECH_S), BUFFER_S)
}

pub fn create_for_dictation(paths: &SttPaths) -> Option<VoiceActivityDetector> {
    VoiceActivityDetector::create(
        &config(paths, DICTATION_MIN_SILENCE_S, DICTATION_MAX_SPEECH_S),
        DICTATION_BUFFER_S,
    )
}

/// Découpe un enregistrement complet en prises de parole : blocs de 512,
/// `flush` pour clore la dernière, puis remise à zéro pour la suivante.
/// Rien d'audible → aucun segment (Parakeet n'invente rien sur du silence).
pub fn segments(vad: &VoiceActivityDetector, samples: &[f32]) -> Vec<Vec<f32>> {
    vad.reset();
    vad.clear();
    for block in samples.chunks(WINDOW) {
        vad.accept_waveform(block);
    }
    vad.flush();
    let mut out = Vec::new();
    while let Some(segment) = vad.front() {
        out.push(segment.samples().to_vec());
        drop(segment);
        vad.pop();
    }
    vad.reset();
    vad.clear();
    out
}
