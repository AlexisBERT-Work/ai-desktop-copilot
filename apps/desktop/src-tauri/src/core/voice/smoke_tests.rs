//! Tests de fumée sur les **vrais** modèles (~800 Mo, hors git — voir
//! `scripts/fetch-voice-models.ps1`). Ignorés par défaut — la CI n'a pas les
//! modèles ; à lancer à la main après un changement de config sherpa-onnx :
//!
//! `cargo test -- --ignored voice::smoke`

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sherpa_onnx::{LinearResampler, Wave};

use super::dictation;
use super::models::{SttPaths, VoiceModels};
use super::stt::Recognizer;
use super::tts::Synthesizer;
use super::vad;
use super::vocabulary::VocabularyCell;

pub(super) fn models() -> VoiceModels {
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
    let stt = Recognizer::create(&paths, VocabularyCell::default()).expect("Parakeet se charge");
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

/// Chemin de la dictée au relâchement : VAD de dictée sur l'enregistrement
/// entier, Parakeet par prise, jointure. Mesure le temps « relâchement →
/// texte » (sans la frappe, quelques ms) — budget visé : < 800 ms pour 5 s.
#[test]
#[ignore = "modèles réels requis (resources/voice)"]
fn smoke_dictee_vad_hors_ligne_puis_stt() {
    let m = models();
    let paths = m.stt().expect("modèles STT présents");
    let vad = vad::create_for_dictation(&paths).expect("VAD de dictée");
    let stt = Recognizer::create(&paths, VocabularyCell::default()).expect("Parakeet se charge");
    let speech = french_test_wav_16k(&paths);
    // Comme une vraie dictée : 0,4 s avant de parler, 0,3 s avant de lâcher.
    let mut samples = vec![0.0f32; 6_400];
    samples.extend_from_slice(&speech);
    samples.extend(std::iter::repeat(0.0f32).take(4_800));
    let audio_s = samples.len() as f32 / vad::SAMPLE_RATE as f32;

    let direct = stt.transcribe(&speech);
    let mut runs = Vec::new();
    let mut text = String::new();
    for _ in 0..5 {
        let started = Instant::now();
        let segments = vad::segments(&vad, &samples);
        text = dictation::join_segments(segments.iter().map(|s| stt.transcribe(s)));
        runs.push(started.elapsed().as_millis());
    }
    runs.sort_unstable();
    let median = runs[runs.len() / 2];
    eprintln!(
        "dictée: {audio_s:.1} s enregistrées, médiane {median} ms (min {} / max {} ms) sur 5 passes",
        runs[0],
        runs[runs.len() - 1]
    );
    eprintln!("dictée : {text:?}");
    eprintln!("direct : {direct:?}");

    assert!(!text.is_empty());
    // Le VAD ne mange pas de mots : même texte qu'en transcription directe,
    // à la ponctuation près.
    let words = |t: &str| {
        t.to_lowercase()
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .map(String::from)
            .collect::<Vec<_>>()
    };
    assert_eq!(words(&text), words(&direct));
    // Silence seul : aucun segment, donc rien à taper.
    assert!(vad::segments(&vad, &vec![0.0f32; 32_000]).is_empty());
    assert!(
        median as f32 / 1000.0 < audio_s * 0.25,
        "transcription trop lente pour la dictée"
    );
}

/// Une phrase lue par Piper, ramenée à 16 kHz comme le micro.
pub(super) fn piper_16k(tts: &Synthesizer, text: &str) -> Vec<f32> {
    let audio: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(vec![]));
    let sink = audio.clone();
    tts.synthesize(text, 1.0, move |samples: &[f32], _| {
        sink.lock().unwrap().extend_from_slice(samples);
        true
    });
    let audio = audio.lock().unwrap().clone();
    LinearResampler::create(tts.sample_rate(), vad::SAMPLE_RATE)
        .expect("resampler")
        .resample(&audio, true)
}

/// Ce que Parakeet a entendu pour une phrase du corpus.
struct Heard {
    voice: String,
    term: Option<&'static str>,
    text: &'static str,
    raw: String,
}

/// Mots repliés d'une phrase (minuscules, sans ponctuation).
fn bench_words(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split(|c: char| !(c.is_alphanumeric() || c == '\'' || c == '’'))
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect()
}

/// Ce que Parakeet a écrit à la place du nom : les mots de la transcription
/// alignés (Levenshtein sur les mots) sur ceux du nom dans la phrase. C'est
/// ce qu'un utilisateur recopierait après « = » en voyant l'erreur.
fn heard_instead(text: &str, term: &str, raw: &str) -> Option<String> {
    let r = bench_words(text);
    let h = bench_words(raw);
    let t = bench_words(term);
    let start = r.windows(t.len()).position(|w| w == t.as_slice())?;
    let range = start..start + t.len();
    let mut d = vec![vec![0usize; h.len() + 1]; r.len() + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in d[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=r.len() {
        for j in 1..=h.len() {
            d[i][j] = (d[i - 1][j - 1] + usize::from(r[i - 1] != h[j - 1]))
                .min(d[i - 1][j] + 1)
                .min(d[i][j - 1] + 1);
        }
    }
    // Remontée : les mots de la transcription rattachés au nom (alignés sur
    // l'un de ses mots, ou insérés entre deux de ses mots).
    let (mut i, mut j) = (r.len(), h.len());
    let mut span: Vec<usize> = Vec::new();
    while i > 0 || j > 0 {
        if i > 0 && j > 0 && d[i][j] == d[i - 1][j - 1] + usize::from(r[i - 1] != h[j - 1]) {
            if range.contains(&(i - 1)) {
                span.push(j - 1);
            }
            i -= 1;
            j -= 1;
        } else if j > 0 && d[i][j] == d[i][j - 1] + 1 {
            if i > range.start && i < range.end {
                span.push(j - 1);
            }
            j -= 1;
        } else {
            i -= 1;
        }
    }
    span.sort_unstable();
    let heard: Vec<&str> = span.iter().map(|&k| h[k].as_str()).collect();
    let term_words: Vec<&str> = t.iter().map(String::as_str).collect();
    (!heard.is_empty() && heard != term_words).then(|| heard.join(" "))
}

/// Banc du vocabulaire (piste « noms propres », veille du 13/11) : chaque
/// phrase du corpus est lue par chaque voix Piper installée et transcrite
/// par Parakeet. Trois vocabulaires sont ensuite essayés sur ces
/// transcriptions :
/// 1. les 20 noms seuls (correction approchée) ;
/// 2. les 20 noms, plus TOUT ce que Parakeet a écrit à leur place avec
///    l'AUTRE voix (validation croisée : jamais appris sur les phrases
///    mesurées), mots courants compris : l'utilisateur négligent ;
/// 3. pareil sans les variantes faites de mots courants : l'utilisateur qui
///    suit l'aide de la carte.
///
/// Mesure les noms exacts avant et après, les faux remplacements sur 100
/// phrases sans nom par voix, et le temps ajouté. Une voix de synthèse n'est
/// pas un micro : c'est un banc reproductible, pas la mesure finale.
///
/// `cargo test -- --ignored smoke_vocabulaire --nocapture`
#[test]
#[ignore = "modèles réels requis (resources/voice)"]
fn smoke_vocabulaire_piper_puis_parakeet() {
    use super::vocabulary::corpus::{NAME_SENTENCES, PLAIN_SENTENCES, TERMS};
    use super::vocabulary::Vocabulary;

    let m = models();
    let paths = m.stt().expect("modèles STT présents");
    let stt = Recognizer::create(&paths, VocabularyCell::default()).expect("Parakeet se charge");
    let voices = m.voices();
    assert!(
        voices.len() >= 2,
        "deux voix Piper pour la validation croisée"
    );

    let (mut heard, mut stt_time, mut audio_s) = (Vec::new(), Duration::ZERO, 0f32);
    for voice in &voices {
        let tts = Synthesizer::create(&m.piper(voice).unwrap()).expect("Piper se charge");
        let clips = NAME_SENTENCES
            .iter()
            .map(|(t, s)| (Some(*t), *s))
            .chain(PLAIN_SENTENCES.iter().map(|s| (None, *s)));
        for (term, text) in clips {
            let audio = piper_16k(&tts, text);
            audio_s += audio.len() as f32 / vad::SAMPLE_RATE as f32;
            let t = Instant::now();
            let raw = stt.transcribe_raw(&audio);
            stt_time += t.elapsed();
            heard.push(Heard {
                voice: voice.clone(),
                term,
                text,
                raw,
            });
        }
    }
    eprintln!(
        "Parakeet : {} ms pour {audio_s:.0} s d'audio",
        stt_time.as_millis()
    );

    // Mots que Parakeet connaît d'un seul morceau : les plus fréquents de ses
    // 25 langues (« base », « main », « test »). Indicateur sans liste écrite
    // à la main, donc sans réglage sur ce corpus.
    let common: std::collections::HashSet<String> = std::fs::read_to_string(&paths.tokens)
        .expect("tokens.txt")
        .lines()
        .filter_map(|l| l.rsplit_once(' ')?.0.strip_prefix('\u{2581}'))
        .filter(|w| w.chars().all(char::is_alphabetic))
        .map(str::to_lowercase)
        .collect();
    let is_common = |variant: &str| {
        bench_words(variant)
            .iter()
            .flat_map(|w| w.split(['\'', '\u{2019}']))
            .all(|w| w.chars().count() < 3 || common.contains(w))
    };

    // Variantes recopiées depuis les erreurs d'une voix.
    let learned = |voice: &str, careful: bool| -> String {
        let mut lines: Vec<String> = Vec::new();
        for term in TERMS {
            let mut variants: Vec<String> = heard
                .iter()
                .filter(|h| h.voice == voice && h.term == Some(term) && !h.raw.contains(term))
                .filter_map(|h| heard_instead(h.text, term, &h.raw))
                .filter(|v| !careful || !is_common(v))
                .collect();
            variants.sort();
            variants.dedup();
            lines.push(if variants.is_empty() {
                term.to_string()
            } else {
                format!("{term} = {}", variants.join(", "))
            });
        }
        lines.join("\n")
    };

    let pct = |n: usize, d: usize| 100.0 * n as f32 / d as f32;
    for (label, variants) in [
        ("noms seuls", None),
        ("noms + toutes les variantes de l'autre voix", Some(false)),
        (
            "noms + variantes de l'autre voix sans mot courant",
            Some(true),
        ),
    ] {
        let (mut names, mut before, mut after, mut plain) = (0usize, 0usize, 0usize, 0usize);
        let mut false_fixes: Vec<String> = Vec::new();
        let mut misses: Vec<String> = Vec::new();
        let mut apply_time = Duration::ZERO;
        for voice in &voices {
            let text = match variants {
                Some(careful) => learned(voices.iter().find(|v| *v != voice).unwrap(), careful),
                None => TERMS.join("\n"),
            };
            let (vocab, _) = Vocabulary::parse(&text);
            for h in heard.iter().filter(|h| &h.voice == voice) {
                let t = Instant::now();
                let fixed = vocab.apply(&h.raw);
                apply_time += t.elapsed();
                match h.term {
                    Some(term) => {
                        names += 1;
                        before += usize::from(h.raw.contains(term));
                        after += usize::from(fixed.contains(term));
                        if !fixed.contains(term) {
                            misses.push(format!("[{voice}] {term} : {:?}", h.raw));
                        }
                    }
                    None => {
                        plain += 1;
                        if fixed != h.raw {
                            false_fixes.push(format!("[{voice}] {:?} → {fixed:?}", h.raw));
                        }
                    }
                }
            }
        }
        eprintln!(
            "\n{label} : noms exacts {before}/{names} ({:.0} %) → {after}/{names} ({:.0} %), {:+.0} points ; faux remplacements {}/{plain} ({:.1} %) ; {:.0} µs par phrase",
            pct(before, names),
            pct(after, names),
            pct(after, names) - pct(before, names),
            false_fixes.len(),
            pct(false_fixes.len(), plain),
            apply_time.as_secs_f64() * 1e6 / heard.len() as f64
        );
        for f in &false_fixes {
            eprintln!("  faux : {f}");
        }
        if let Some(careful) = variants {
            for voice in &voices {
                eprintln!(
                    "  variantes apprises de {voice} :\n{}",
                    learned(voice, careful)
                );
            }
        }
        for miss in &misses {
            eprintln!("  raté : {miss}");
        }
        assert!(
            after >= before,
            "le vocabulaire ne doit jamais faire perdre un nom"
        );
    }
}
