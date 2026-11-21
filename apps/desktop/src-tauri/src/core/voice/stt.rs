//! Reconnaissance vocale hors-ligne : Parakeet TDT 0.6B v3 (NVIDIA, CC-BY-4.0)
//! en int8 via sherpa-onnx. 25 langues détectées automatiquement, WER
//! français 4,97 % — mieux que Whisper large-v3 pour un quart de la taille.

use sherpa_onnx::{
    OfflineModelConfig, OfflineRecognizer, OfflineRecognizerConfig, OfflineTransducerModelConfig,
};

use tracing::debug;

use super::models::SttPaths;
use super::vad::SAMPLE_RATE;
use super::vocabulary::VocabularyCell;

/// Threads d'inférence : la moitié d'un Ryzen 5 5500, le reste pour Ollama et l'UI.
const NUM_THREADS: i32 = 4;

pub struct Recognizer {
    inner: OfflineRecognizer,
    vocabulary: VocabularyCell,
}

impl Recognizer {
    pub fn create(paths: &SttPaths, vocabulary: VocabularyCell) -> Option<Self> {
        let config = OfflineRecognizerConfig {
            model_config: OfflineModelConfig {
                transducer: OfflineTransducerModelConfig {
                    encoder: Some(paths.encoder.display().to_string()),
                    decoder: Some(paths.decoder.display().to_string()),
                    joiner: Some(paths.joiner.display().to_string()),
                },
                tokens: Some(paths.tokens.display().to_string()),
                num_threads: NUM_THREADS,
                provider: Some("cpu".into()),
                model_type: Some("nemo_transducer".into()),
                ..Default::default()
            },
            decoding_method: Some("greedy_search".into()),
            ..Default::default()
        };
        OfflineRecognizer::create(&config).map(|inner| Self { inner, vocabulary })
    }

    /// Transcrit une prise de parole mono 16 kHz, vocabulaire personnel
    /// appliqué : le chat vocal et la dictée passent tous deux par ici.
    /// Texte nettoyé, éventuellement vide.
    pub fn transcribe(&self, samples: &[f32]) -> String {
        let raw = self.transcribe_raw(samples);
        let text = self.vocabulary.correct(&raw);
        if text != raw {
            // Jamais le texte dans le journal : il peut contenir des noms.
            debug!("voice: vocabulaire appliqué");
        }
        text
    }

    /// La sortie de Parakeet telle quelle (banc de mesure du vocabulaire).
    pub fn transcribe_raw(&self, samples: &[f32]) -> String {
        let stream = self.inner.create_stream();
        stream.accept_waveform(SAMPLE_RATE, samples);
        self.inner.decode(&stream);
        stream
            .get_result()
            .map(|r| r.text.trim().to_string())
            .unwrap_or_default()
    }
}
