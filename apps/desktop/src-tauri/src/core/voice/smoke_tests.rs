//! Tests de fumée sur les **vrais** modèles (~800 Mo, hors git — voir
//! `scripts/fetch-voice-models.ps1`). Ignorés par défaut — la CI n'a pas les
//! modèles ; à lancer à la main après un changement de config sherpa-onnx :
//!
//! `cargo test -- --ignored voice::smoke`

use std::sync::{Arc, Mutex};
use std::time::Instant;

use sherpa_onnx::{LinearResampler, Wave};

use super::models::{SttPaths, VoiceModels};
use super::stt::Recognizer;
use super::tts::Synthesizer;
use super::vad;

fn models() -> VoiceModels {
    VoiceModels::discover_local()
}

/// Le wav français livré avec Parakeet (`test_wavs/fr.wav`, gardé par le
/// script de récupération), ramené à 16 kHz comme le ferait le micro (il est
/// en 22 050 Hz).
fn french_test_wav_16k(paths: &SttPaths) -> Vec<f32> {
    let wav_path = paths
        .encoder
        .parent()
        .unwrap()
        .join("test_wavs")
        .join("fr.wav");
    let wav = Wave::read(wav_path.to_str().unwrap()).expect("wav de test présent");
    if wav.sample_rate() == vad::SAMPLE_RATE {
        return wav.samples().to_vec();
    }
    LinearResampler::create(wav.sample_rate(), vad::SAMPLE_RATE)
        .expect("resampler")
        .resample(wav.samples(), true)
}

#[test]
#[ignore = "modèles réels requis (resources/voice)"]
fn smoke_parakeet_transcrit_le_wav_francais_de_test() {
    let m = models();
    let paths = m.stt().expect("modèles STT présents");
    let stt = Recognizer::create(&paths).expect("Parakeet se charge");
    let samples = french_test_wav_16k(&paths);

    let started = Instant::now();
    let text = stt.transcribe(&samples);
    let elapsed = started.elapsed();
    let audio_s = samples.len() as f32 / vad::SAMPLE_RATE as f32;
    eprintln!(
        "parakeet: {audio_s:.1} s d'audio en {} ms (RTF {:.3}) → {text:?}",
        elapsed.as_millis(),
        elapsed.as_secs_f32() / audio_s
    );
    assert!(!text.is_empty());
    assert!(
        elapsed.as_secs_f32() < audio_s,
        "plus lent que le temps réel"
    );
}

#[test]
#[ignore = "modèles réels requis (resources/voice)"]
fn smoke_vad_decoupe_le_wav_de_test_en_une_prise() {
    let m = models();
    let paths = m.stt().expect("modèles STT présents");
    let vad = vad::create(&paths).expect("Silero se charge");
    let samples = french_test_wav_16k(&paths);

    // Comme le micro : morceaux de 20 ms.
    for chunk in samples.chunks(320) {
        vad.accept_waveform(chunk);
    }
    vad.flush();
    let mut segments = 0;
    let mut spoken = 0usize;
    while let Some(seg) = vad.front() {
        segments += 1;
        spoken += seg.samples().len();
        drop(seg);
        vad.pop();
    }
    eprintln!(
        "vad: {segments} prise(s), {:.1} s de parole sur {:.1} s",
        spoken as f32 / 16_000.0,
        samples.len() as f32 / 16_000.0
    );
    assert!(segments >= 1);
    assert!(spoken > 16_000, "au moins une seconde de parole détectée");
}

#[test]
#[ignore = "modèles réels requis (resources/voice)"]
fn smoke_piper_synthetise_par_phrase_via_le_rappel() {
    let m = models();
    let paths = m
        .piper(super::models::DEFAULT_VOICE)
        .expect("voix Piper présente");
    let started = Instant::now();
    let tts = Synthesizer::create(&paths).expect("Piper se charge");
    eprintln!(
        "piper: chargé en {} ms, {} Hz",
        started.elapsed().as_millis(),
        tts.sample_rate()
    );

    let chunks: Arc<Mutex<Vec<usize>>> = Arc::new(Mutex::new(vec![]));
    let sink = chunks.clone();
    let started = Instant::now();
    tts.synthesize(
        "Bonjour Alexis. La revue de presse compte sept articles.",
        1.0,
        move |samples: &[f32], _| {
            sink.lock().unwrap().push(samples.len());
            true
        },
    );
    let elapsed = started.elapsed();
    let chunks = chunks.lock().unwrap().clone();
    let total: usize = chunks.iter().sum();
    let audio_s = total as f32 / tts.sample_rate() as f32;
    eprintln!(
        "piper: {} morceau(x) {chunks:?}, {audio_s:.1} s d'audio en {} ms (RTF {:.3})",
        chunks.len(),
        elapsed.as_millis(),
        elapsed.as_secs_f32() / audio_s
    );
    // Deux phrases → deux morceaux (max_num_sentences = 1) : c'est ce qui
    // permet de commencer à parler avant la fin de la synthèse.
    assert_eq!(chunks.len(), 2);
    assert!(audio_s > 1.0);
    assert!(
        elapsed.as_secs_f32() < audio_s * 0.5,
        "Piper doit être ≥ 2× temps réel"
    );
}

#[test]
#[ignore = "modèles réels requis (resources/voice)"]
fn smoke_le_rappel_peut_interrompre_la_synthese() {
    let m = models();
    let paths = m
        .piper(super::models::DEFAULT_VOICE)
        .expect("voix Piper présente");
    let tts = Synthesizer::create(&paths).expect("Piper se charge");
    let calls = Arc::new(Mutex::new(0));
    let sink = calls.clone();
    tts.synthesize(
        "Première phrase. Deuxième phrase. Troisième phrase.",
        1.0,
        move |_: &[f32], _| {
            *sink.lock().unwrap() += 1;
            false // stop dès le premier morceau
        },
    );
    assert_eq!(*calls.lock().unwrap(), 1);
}
