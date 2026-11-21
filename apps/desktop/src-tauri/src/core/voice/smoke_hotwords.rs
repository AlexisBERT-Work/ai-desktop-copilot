//! Banc de l'étape 2 du vocabulaire : les hotwords de sherpa-onnx valent-ils
//! leur coût ? Rien ici n'est en service : CatDesk décode en `greedy_search`.
//!
//! Pour Parakeet (transducteur NeMo), sherpa-onnx ne prend les hotwords qu'en
//! `modified_beam_search`, et cherche chaque ligne telle quelle dans
//! `tokens.txt` : un mot découpé en plusieurs pièces BPE est rejeté, et avec
//! lui toute la liste. On écrit donc les termes en pièces nous-mêmes.
//!
//! `cargo test -- --ignored smoke_hotwords --nocapture`

use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration, Instant};

use sherpa_onnx::{
    OfflineModelConfig, OfflineRecognizer, OfflineRecognizerConfig, OfflineTransducerModelConfig,
};

use super::models::SttPaths;
use super::smoke_tests::{models, piper_16k};
use super::tts::Synthesizer;
use super::vad;
use super::vocabulary::corpus::{NAME_SENTENCES, PLAIN_SENTENCES, TERMS};
use super::vocabulary::Vocabulary;

/// Marqueur de début de mot de SentencePiece.
const SPACE: char = '▁';

/// Encodeur BPE minimal, adapté d'Umless (github.com/jatinbishla/Umless,
/// Apache-2.0, `crates/umless-asr/src/hotwords.rs`, commit ded641f) :
/// `tokens.txt` est rangé par ordre de fusion, donc fusionner la paire
/// voisine d'id le plus bas, jusqu'à ce que rien ne fusionne, reproduit le
/// découpage du modèle.
struct Bpe {
    ids: HashMap<String, usize>,
}

impl Bpe {
    fn load(tokens: &Path) -> Self {
        let text = std::fs::read_to_string(tokens).expect("tokens.txt");
        let ids = text
            .lines()
            .filter_map(|l| {
                let (piece, id) = l.rsplit_once(' ')?;
                Some((piece.to_string(), id.trim().parse().ok()?))
            })
            .collect();
        Self { ids }
    }

    fn encode_word(&self, word: &str) -> Option<Vec<String>> {
        let mut syms: Vec<String> = std::iter::once(SPACE)
            .chain(word.chars())
            .map(String::from)
            .collect();
        loop {
            let best = syms
                .windows(2)
                .enumerate()
                .filter_map(|(i, p)| Some((self.ids.get(&format!("{}{}", p[0], p[1]))?, i)))
                .min();
            let Some((_, i)) = best else { break };
            let right = syms.remove(i + 1);
            syms[i].push_str(&right);
        }
        syms.iter()
            .all(|s| self.ids.contains_key(s))
            .then_some(syms)
    }

    /// Une ligne de hotword par terme, telle qu'écrite et en casse inversée
    /// sur la première lettre (le modèle sort de la casse).
    fn lines(&self, phrases: &[&str]) -> (String, usize) {
        let mut lines: Vec<String> = Vec::new();
        let mut skipped = 0;
        for phrase in phrases {
            let mut chars = phrase.chars();
            let flipped: String = match chars.next() {
                Some(f) if f.is_uppercase() => f.to_lowercase().chain(chars).collect(),
                Some(f) => f.to_uppercase().chain(chars).collect(),
                None => continue,
            };
            for variant in [phrase.to_string(), flipped] {
                let pieces: Option<Vec<String>> = variant
                    .split_whitespace()
                    .map(|w| self.encode_word(w))
                    .collect::<Option<Vec<Vec<String>>>>()
                    .map(|v| v.concat());
                match pieces {
                    Some(p) if !p.is_empty() => {
                        let line = p.join(" ");
                        if !lines.contains(&line) {
                            lines.push(line);
                        }
                    }
                    _ => skipped += 1,
                }
            }
        }
        (lines.join("\n"), skipped)
    }
}

fn recognizer(paths: &SttPaths, method: &str, score: f32) -> OfflineRecognizer {
    let config = OfflineRecognizerConfig {
        model_config: OfflineModelConfig {
            transducer: OfflineTransducerModelConfig {
                encoder: Some(paths.encoder.display().to_string()),
                decoder: Some(paths.decoder.display().to_string()),
                joiner: Some(paths.joiner.display().to_string()),
            },
            tokens: Some(paths.tokens.display().to_string()),
            num_threads: 4,
            provider: Some("cpu".into()),
            model_type: Some("nemo_transducer".into()),
            ..Default::default()
        },
        decoding_method: Some(method.into()),
        max_active_paths: 4,
        hotwords_score: score,
        ..Default::default()
    };
    OfflineRecognizer::create(&config).expect("Parakeet se charge")
}

/// Mots repliés, pour un taux d'erreur relatif entre configurations (les
/// nombres écrits en chiffres comptent comme erreurs partout pareil).
fn words(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect()
}

fn word_errors(reference: &str, hypothesis: &str) -> (usize, usize) {
    let r = words(reference);
    let h = words(hypothesis);
    let mut prev: Vec<usize> = (0..=h.len()).collect();
    for (i, rw) in r.iter().enumerate() {
        let mut cur = vec![i + 1];
        for (j, hw) in h.iter().enumerate() {
            cur.push(
                (prev[j] + usize::from(rw != hw))
                    .min(prev[j + 1] + 1)
                    .min(cur[j] + 1),
            );
        }
        prev = cur;
    }
    (prev[h.len()], r.len())
}

struct Clip {
    term: Option<&'static str>,
    text: &'static str,
    audio: Vec<f32>,
}

#[test]
#[ignore = "modèles réels requis (resources/voice)"]
fn smoke_hotwords_beam_contre_greedy() {
    let m = models();
    let paths = m.stt().expect("modèles STT présents");
    let bpe = Bpe::load(&paths.tokens);
    let (hotwords, skipped) = bpe.lines(&TERMS);
    eprintln!(
        "hotwords : {} lignes, {skipped} variante(s) impossibles à écrire en pièces",
        hotwords.lines().count()
    );
    for line in hotwords.lines().take(6) {
        eprintln!("  {line}");
    }
    let (vocab, _) = Vocabulary::parse(&TERMS.join("\n"));

    let mut clips: Vec<Clip> = Vec::new();
    for voice in m.voices() {
        let tts = Synthesizer::create(&m.piper(&voice).unwrap()).expect("Piper se charge");
        for (term, text) in NAME_SENTENCES {
            clips.push(Clip {
                term: Some(term),
                text,
                audio: piper_16k(&tts, text),
            });
        }
        for text in PLAIN_SENTENCES {
            clips.push(Clip {
                term: None,
                text,
                audio: piper_16k(&tts, text),
            });
        }
    }
    let audio_s: f32 = clips
        .iter()
        .map(|c| c.audio.len() as f32 / vad::SAMPLE_RATE as f32)
        .sum();
    eprintln!("{} extraits, {audio_s:.0} s d'audio", clips.len());

    eprintln!(
        "\n| Décodage | Noms exacts (brut) | Noms exacts (+ vocabulaire) | Noms inventés | Taux d'erreur par mot | Temps pour 5 s |"
    );
    eprintln!("|---|---|---|---|---|---|");
    for (label, method, score) in [
        ("greedy (en service)", "greedy_search", 0.0),
        ("beam, sans hotwords", "modified_beam_search", 0.0),
        ("beam + hotwords 1,5", "modified_beam_search", 1.5),
        ("beam + hotwords 2,0", "modified_beam_search", 2.0),
        // Diagnostic, pas un réglage possible : le mécanisme agit-il ?
        (
            "beam + hotwords 8 (diagnostic)",
            "modified_beam_search",
            8.0,
        ),
    ] {
        let rec = recognizer(&paths, method, score);
        let (mut names, mut raw_ok, mut fixed_ok, mut invented) = (0, 0, 0, 0);
        let (mut errors, mut total) = (0usize, 0usize);
        let mut elapsed = Duration::ZERO;
        for clip in &clips {
            let started = Instant::now();
            let stream = if score > 0.0 {
                rec.create_stream_with_hotwords(&hotwords)
            } else {
                rec.create_stream()
            };
            stream.accept_waveform(vad::SAMPLE_RATE, &clip.audio);
            rec.decode(&stream);
            let raw = stream
                .get_result()
                .map(|r| r.text.trim().to_string())
                .unwrap_or_default();
            elapsed += started.elapsed();

            let (e, n) = word_errors(clip.text, &raw);
            errors += e;
            total += n;
            match clip.term {
                Some(term) => {
                    names += 1;
                    raw_ok += usize::from(raw.contains(term));
                    fixed_ok += usize::from(vocab.apply(&raw).contains(term));
                }
                None => {
                    if TERMS.iter().any(|t| raw.contains(t)) {
                        invented += 1;
                        eprintln!("  [{label}] inventé : {raw:?}");
                    }
                }
            }
        }
        let per_5s = elapsed.as_secs_f32() * 5.0 / audio_s * 1000.0;
        eprintln!(
            "| {label} | {raw_ok}/{names} | {fixed_ok}/{names} | {invented}/{} | {:.1} % | {per_5s:.0} ms |",
            clips.len() - names,
            100.0 * errors as f32 / total as f32
        );
    }
}
