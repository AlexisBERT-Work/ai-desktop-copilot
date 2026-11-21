use std::time::Instant;

use super::corpus::{NAME_SENTENCES, PLAIN_SENTENCES, TERMS};
use super::*;

fn vocab(text: &str) -> Vocabulary {
    Vocabulary::parse(text).0
}

fn all_terms() -> Vocabulary {
    vocab(&TERMS.join("\n"))
}

#[test]
fn corrige_les_quasi_homophones() {
    let v = all_terms();
    for (heard, wanted) in [
        (
            "Ouvre Cat Desk et lance la revue.",
            "Ouvre CatDesk et lance la revue.",
        ),
        ("ouvre catdesk", "ouvre CatDesk"),
        (
            "Redémarre Olama avant le banc.",
            "Redémarre Ollama avant le banc.",
        ),
        ("Olama, réponds.", "Ollama, réponds."),
        ("le modèle de l'Olama", "le modèle de l'Ollama"),
        ("Compare Kwen avec l'ancien.", "Compare Qwen avec l'ancien."),
        (
            "La réponse de Quen était longue.",
            "La réponse de Qwen était longue.",
        ),
        (
            "Installe Ken Saku pour les PDF.",
            "Installe Kensaku pour les PDF.",
        ),
        (
            "Kensakou a trouvé la capture.",
            "Kensaku a trouvé la capture.",
        ),
        ("écrit avec Taury et React", "écrit avec Tauri et React"),
        (
            "Thibaut arrive à dix heures.",
            "Thibault arrive à dix heures.",
        ),
        ("Rappelle Maelle demain.", "Rappelle Maëlle demain."),
        ("Mon cours à sup de vinci", "Mon cours à Sup de Vinci"),
        (
            "Pousse la branche sur Git Hub.",
            "Pousse la branche sur GitHub.",
        ),
        (
            "publiés sur Supabaze chaque nuit",
            "publiés sur Supabase chaque nuit",
        ),
        (
            "publiés sur Supa base chaque nuit",
            "publiés sur Supabase chaque nuit",
        ),
        (
            "Félicite Kilian pour son examen.",
            "Félicite Kylian pour son examen.",
        ),
        ("le store Zoustand", "le store Zustand"),
    ] {
        assert_eq!(v.apply(heard), wanted, "entendu : {heard:?}");
    }
}

#[test]
fn laisse_les_mots_courants_tranquilles() {
    let v = all_terms();
    for s in [
        "Qu'en penses-tu ?",
        "Il a monté une super base de données.",
        "Les lamas du zoo dorment.",
        "Quand est-ce que tu viens ?",
        "Il est rentré tard.",
        "Le taureau a chargé.",
        "Un collier en obsidienne.",
        "Fais vite, le bus arrive.",
        "aujourd'hui",
        "Le parquet est ciré.",
        "Il fait un temps superbe.",
        // Une flexion du terme est un autre mot.
        "Deux Nexuss",
        // Une ponctuation coupe : ce ne sont pas les deux moitiés d'un nom.
        "le chat, desk",
    ] {
        assert_eq!(v.apply(s), s);
    }
}

#[test]
fn les_phrases_deja_justes_ne_bougent_pas() {
    let v = all_terms();
    for (_, s) in NAME_SENTENCES {
        assert_eq!(v.apply(s), s);
    }
}

#[test]
fn faux_remplacements_sur_100_phrases_sans_nom() {
    let v = all_terms();
    let changed: Vec<(String, String)> = PLAIN_SENTENCES
        .iter()
        .map(|s| (s.to_string(), v.apply(s)))
        .filter(|(before, after)| before != after)
        .collect();
    eprintln!("faux remplacements : {}/100 {changed:?}", changed.len());
    // Cible du rapport de veille : 1 % au plus.
    assert!(changed.len() <= 1, "{changed:?}");
}

#[test]
fn les_variantes_se_remplacent_telles_quelles() {
    let v = vocab("Supabase = super base, supa base\nSiobhan = Chivonne, shi vonne\nC# = c sharp");
    assert_eq!(
        v.apply("publié sur super base cette nuit"),
        "publié sur Supabase cette nuit"
    );
    assert_eq!(
        v.apply("Chivonne présente vendredi."),
        "Siobhan présente vendredi."
    );
    assert_eq!(v.apply("Demande à Shi Vonne."), "Demande à Siobhan.");
    assert_eq!(v.apply("écrit en c sharp"), "écrit en C#");
    // Une ponctuation coupe la suite : « super, base » n'est pas la variante.
    assert_eq!(v.apply("super, base"), "super, base");
}

#[test]
fn lit_le_fichier_et_signale_ce_qui_ne_sert_pas() {
    let (v, summary) = Vocabulary::parse(
        "# mes noms\nCatDesk\n\nAI\nC# = c sharp  # langage\n= orphelin\nCatDesk\nOllama=olama\n",
    );
    assert_eq!(summary.terms, 3, "{summary:?}"); // CatDesk, C#, Ollama
    assert_eq!(summary.aliases, 2);
    assert_eq!(summary.problems.len(), 2, "{summary:?}");
    assert!(summary.problems[0].contains("« AI »"));
    assert!(summary.problems[1].contains("Ligne 6"));
    assert_eq!(v.apply("ouvre catdesk"), "ouvre CatDesk");
}

#[test]
fn refuse_les_variantes_d_un_mot_trop_court() {
    let (v, summary) = Vocabulary::parse("Ollama = a, j'y, olama, la main\nGitHub = jub");
    assert_eq!(summary.aliases, 3, "{summary:?}"); // olama, la main, jub
    assert_eq!(summary.problems.len(), 2, "{summary:?}");
    assert!(summary.problems[0].contains("« a »"));
    assert!(summary.problems[1].contains("« j'y »"));
    assert_eq!(v.apply("Il a dit oui."), "Il a dit oui.");
    assert_eq!(v.apply("J'y vais."), "J'y vais.");
    assert_eq!(v.apply("Pousse sur jub."), "Pousse sur GitHub.");
}

#[test]
fn bornes_du_fichier() {
    let long = format!("{}\nCatDesk", "x".repeat(MAX_LINE_CHARS + 1));
    let (_, summary) = Vocabulary::parse(&long);
    assert_eq!(summary.terms, 1);
    assert!(summary.problems[0].contains("Ligne 1"));

    let many: String = (0..MAX_ENTRIES + 5)
        .map(|i| format!("Terme{i}\n"))
        .collect();
    let (_, summary) = Vocabulary::parse(&many);
    assert_eq!(summary.terms, MAX_ENTRIES);
    assert!(summary.problems[0].contains("500"));

    assert!(validate(&"a".repeat(MAX_BYTES + 1)).is_err());
    assert!(validate("CatDesk\u{0007}").is_err());
    assert!(validate("CatDesk\r\nOllama = olama\t\n").is_ok());
}

#[test]
fn cle_phonetique_francaise() {
    assert_eq!(sound(&letters("Ollama")), "alm");
    assert_eq!(sound(&letters("Olama")), "alm");
    assert_eq!(sound(&letters("Qwen")), "kn");
    assert_eq!(sound(&letters("Quen")), "kn");
    assert_eq!(sound(&letters("Kwen")), "kn");
    assert_eq!(sound(&letters("château")), "xt");
    assert_eq!(sound(&letters("Philippe")), "flp");
    assert_eq!(sound(&letters("garçon")), "grsn");
    assert_eq!(sound(&letters("garde")), "grd");
    assert_eq!(sound(&letters("Guillaume")), "glm");
    assert_eq!(sound(&letters("Thibault")), "tblt");
    assert_eq!(sound(&letters("Maëlle")), "ml");
    assert_eq!(letters("Sup de Vinci"), "supdevinci");
}

#[test]
fn coupee_elle_ne_corrige_rien() {
    let cell = VocabularyCell::from_text(None, "CatDesk");
    assert_eq!(cell.correct("ouvre Cat Desk"), "ouvre CatDesk");
    cell.set_enabled(false);
    assert_eq!(cell.correct("ouvre Cat Desk"), "ouvre Cat Desk");
}

#[test]
fn enregistre_le_fichier_puis_le_met_en_service() {
    let dir = std::env::temp_dir().join(format!("catdesk-vocab-{}", std::process::id()));
    let path = file_path(&dir);
    let cell = VocabularyCell::load(Some(path.clone()));
    assert_eq!(cell.read_text().unwrap(), "");
    assert_eq!(cell.correct("ouvre Cat Desk"), "ouvre Cat Desk");

    let summary = cell.save("CatDesk\nSiobhan = Chivonne\n").unwrap();
    assert_eq!((summary.terms, summary.aliases), (2, 1));
    assert_eq!(cell.correct("ouvre Cat Desk"), "ouvre CatDesk");
    assert_eq!(cell.read_text().unwrap(), "CatDesk\nSiobhan = Chivonne\n");
    // Rechargé depuis le disque, comme au prochain démarrage.
    assert_eq!(
        VocabularyCell::load(Some(path.clone())).correct("Chivonne"),
        "Siobhan"
    );
    // Refusé : rien n'est écrit, l'ancien vocabulaire reste en service.
    assert!(cell.save("bip\u{0007}").is_err());
    assert_eq!(cell.correct("ouvre Cat Desk"), "ouvre CatDesk");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn ajoute_moins_d_une_milliseconde_sur_5_s_de_parole() {
    let v = all_terms();
    // ~5 s de parole : une quinzaine de mots.
    let text = "Bon alors tu peux demander à Kwen de résumer la réunion de ce matin avec Thibaut et Maelle";
    let runs = 200;
    let started = Instant::now();
    for _ in 0..runs {
        std::hint::black_box(v.apply(std::hint::black_box(text)));
    }
    let per_call = started.elapsed() / runs;
    eprintln!("vocabulaire : {per_call:?} par transcription de 17 mots, 20 termes");
    // Cible du rapport : < 50 ms. Seuil large pour une CI lente.
    assert!(per_call.as_millis() < 5, "{per_call:?}");
}

/// Mesure, pas un garde-fou : faux remplacements sur la doc du dépôt (des
/// milliers de lignes de français technique), lignes sans aucun nom du corpus.
/// `cargo test -- --ignored vocabulaire_sur_la_doc --nocapture`
#[test]
#[ignore = "mesure sur la doc du dépôt"]
fn mesure_vocabulaire_sur_la_doc() {
    let v = all_terms();
    let docs = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../docs");
    let folded: Vec<String> = TERMS.iter().map(|t| letters(t)).collect();
    let (mut lines, mut changed) = (0usize, Vec::new());
    for entry in std::fs::read_dir(&docs).expect("dossier docs") {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        for line in text.lines().filter(|l| l.split_whitespace().count() >= 4) {
            let l = letters(line);
            if folded.iter().any(|t| l.contains(t.as_str())) {
                continue;
            }
            lines += 1;
            let after = v.apply(line);
            if after != line {
                changed.push((line.to_string(), after));
            }
        }
    }
    eprintln!("doc : {} lignes modifiées sur {lines}", changed.len());
    for (before, after) in changed.iter().take(20) {
        eprintln!("  - {before}\n  + {after}");
    }
}

/// Protocole au micro, étape 1 : écrit les deux feuilles à lire dans le
/// dossier `CATDESK_DICTEE` (`feuille-noms.txt`, 60 phrases ;
/// `feuille-phrases.txt`, 100 phrases sans nom). Voir
/// `docs/AMELIORATIONS.md` § 0, point 8.
#[test]
#[ignore = "protocole au micro (CATDESK_DICTEE)"]
fn feuille_de_dictee_vocabulaire() {
    let dir = std::path::PathBuf::from(std::env::var("CATDESK_DICTEE").expect("CATDESK_DICTEE"));
    std::fs::create_dir_all(&dir).unwrap();
    let names: Vec<&str> = NAME_SENTENCES.iter().map(|(_, s)| *s).collect();
    std::fs::write(dir.join("feuille-noms.txt"), names.join("\n") + "\n").unwrap();
    std::fs::write(
        dir.join("feuille-phrases.txt"),
        PLAIN_SENTENCES.join("\n") + "\n",
    )
    .unwrap();
    std::fs::write(dir.join("vocabulaire.txt"), TERMS.join("\n") + "\n").unwrap();
    eprintln!("feuilles écrites dans {}", dir.display());
}

/// Protocole au micro, étape 2 : `noms.txt` et `phrases.txt`, dictés
/// vocabulaire COUPÉ (une phrase par ligne, dans l'ordre des feuilles),
/// corrigés ici après coup par le vocabulaire de `CATDESK_VOCABULAIRE`
/// (par défaut les 20 noms). Avant et après viennent du même enregistrement.
#[test]
#[ignore = "protocole au micro (CATDESK_DICTEE)"]
fn mesure_vocabulaire_sur_ma_dictee() {
    let dir = std::path::PathBuf::from(std::env::var("CATDESK_DICTEE").expect("CATDESK_DICTEE"));
    let read_lines = |name: &str| -> Vec<String> {
        std::fs::read_to_string(dir.join(name))
            .unwrap_or_else(|e| panic!("{name} : {e}"))
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect()
    };
    let text = match std::env::var("CATDESK_VOCABULAIRE") {
        Ok(path) => std::fs::read_to_string(path).expect("CATDESK_VOCABULAIRE"),
        Err(_) => TERMS.join("\n"),
    };
    let v = vocab(&text);

    let heard = read_lines("noms.txt");
    if heard.len() != NAME_SENTENCES.len() {
        eprintln!(
            "! noms.txt : {} lignes pour {} phrases, alignement ligne à ligne",
            heard.len(),
            NAME_SENTENCES.len()
        );
    }
    let (mut before, mut after) = (0usize, 0usize);
    for (i, (term, _)) in NAME_SENTENCES.iter().enumerate() {
        let raw = heard.get(i).map(String::as_str).unwrap_or("");
        let fixed = v.apply(raw);
        before += usize::from(raw.contains(term));
        after += usize::from(fixed.contains(term));
        if !fixed.contains(term) {
            eprintln!("  raté {:>2} {term} : {raw:?}", i + 1);
        }
    }
    let n = NAME_SENTENCES.len() as f32;
    eprintln!(
        "noms exacts : {before}/60 ({:.0} %) → {after}/60 ({:.0} %), {:+.0} points (cible +30)",
        100.0 * before as f32 / n,
        100.0 * after as f32 / n,
        100.0 * (after as f32 - before as f32) / n
    );

    let plain = read_lines("phrases.txt");
    let changed: Vec<(String, String)> = plain
        .iter()
        .map(|l| (l.clone(), v.apply(l)))
        .filter(|(raw, fixed)| raw != fixed)
        .collect();
    eprintln!(
        "faux remplacements : {}/{} (cible 1 % au plus)",
        changed.len(),
        plain.len()
    );
    for (raw, fixed) in &changed {
        eprintln!("  - {raw}\n  + {fixed}");
    }
}
