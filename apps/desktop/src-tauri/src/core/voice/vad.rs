//! Détection de parole (Silero VAD via sherpa-onnx) : découpe le flux micro en
//! prises de parole, et décide de la fin de tour au silence.

use sherpa_onnx::{SileroVadModelConfig, VadModelConfig, VoiceActivityDetector};

use super::models::SttPaths;

/// Fréquence d'échantillonnage imposée par Silero et Parakeet.
pub const SAMPLE_RATE: i32 = 16_000;
/// Silence qui clôt un tour de parole. 0,7 s laisse respirer une phrase sans
/// couper au premier « euh ».
const MIN_SILENCE_S: f32 = 0.7;
/// En dessous, ce n'est pas de la parole (un clic, une toux).
const MIN_SPEECH_S: f32 = 0.25;
/// Garde-fou : une consigne à un assistant ne dure pas 15 s.
const MAX_SPEECH_S: f32 = 15.0;
/// Tampon interne du VAD, en secondes — doit contenir la plus longue prise.
const BUFFER_S: f32 = 30.0;

pub fn create(paths: &SttPaths) -> Option<VoiceActivityDetector> {
    let config = VadModelConfig {
        silero_vad: SileroVadModelConfig {
            model: Some(paths.vad.display().to_string()),
            threshold: 0.5,
            min_silence_duration: MIN_SILENCE_S,
            min_speech_duration: MIN_SPEECH_S,
            window_size: 512,
            max_speech_duration: MAX_SPEECH_S,
        },
        sample_rate: SAMPLE_RATE,
        num_threads: 1,
        provider: Some("cpu".into()),
        ..Default::default()
    };
    VoiceActivityDetector::create(&config, BUFFER_S)
}
