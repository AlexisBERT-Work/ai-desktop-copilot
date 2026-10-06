//! Synthèse vocale hors-ligne : Piper (VITS) via sherpa-onnx.
//!
//! Choisi au test d'écoute du 2026-09-11 (Ryzen 5 5500) : premier son en
//! 64–83 ms, 18× temps réel. Kokoro et Pocket TTS, pourtant plus récents,
//! sont **plus lents que le temps réel** en français sur ce CPU (RTF 1,3–1,4)
//! et bégaieraient en direct.

use sherpa_onnx::{
    GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsModelConfig,
    OfflineTtsVitsModelConfig,
};

use super::models::PiperPaths;

/// Piper est léger : deux threads suffisent largement pour rester loin
/// devant la lecture, et on laisse la place au STT et à Ollama.
const NUM_THREADS: i32 = 2;

pub struct Synthesizer {
    inner: OfflineTts,
    sample_rate: i32,
}

impl Synthesizer {
    pub fn create(paths: &PiperPaths) -> Option<Self> {
        let config = OfflineTtsConfig {
            model: OfflineTtsModelConfig {
                vits: OfflineTtsVitsModelConfig {
                    model: Some(paths.model.display().to_string()),
                    tokens: Some(paths.tokens.display().to_string()),
                    data_dir: Some(paths.espeak_data.display().to_string()),
                    lexicon: Some(String::new()),
                    noise_scale: 0.667,
                    noise_scale_w: 0.8,
                    length_scale: 1.0,
                    dict_dir: None,
                },
                num_threads: NUM_THREADS,
                debug: false,
                provider: Some("cpu".into()),
                ..Default::default()
            },
            // Une phrase à la fois : le rappel reçoit l'audio dès qu'elle est
            // prête, sans attendre la fin du texte.
            max_num_sentences: 1,
            silence_scale: 0.2,
            ..Default::default()
        };
        let inner = OfflineTts::create(&config)?;
        let sample_rate = inner.sample_rate();
        Some(Self { inner, sample_rate })
    }

    pub fn sample_rate(&self) -> i32 {
        self.sample_rate
    }

    /// Synthétise `text` et livre l'audio par morceaux à `on_chunk`, qui
    /// renvoie `false` pour interrompre (barge-in, Ctrl+Espace).
    pub fn synthesize<F>(&self, text: &str, speed: f32, on_chunk: F)
    where
        F: FnMut(&[f32], f32) -> bool + 'static,
    {
        let config = GenerationConfig {
            speed,
            ..Default::default()
        };
        // L'audio complet est aussi renvoyé, mais on ne s'en sert pas : tout
        // est déjà passé par le rappel, morceau par morceau.
        let _ = self
            .inner
            .generate_with_config(text, &config, Some(on_chunk));
    }
}
