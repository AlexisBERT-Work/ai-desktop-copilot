//! Vocabulaire personnel de la reconnaissance vocale : noms propres, produits,
//! applications, écrits comme l'utilisateur les écrit (« CatDesk », pas
//! « Cat Desk » ; « Ollama », pas « Olama »).
//!
//! Post-correction, après Parakeet, pour le chat vocal comme pour la dictée
//! (les deux passent par [`super::stt::Recognizer::transcribe`]) : une suite
//! de mots de la transcription est remplacée par un terme du vocabulaire quand
//! elle se prononce pareil et s'écrit presque pareil. Les variantes écrites
//! après « = » se remplacent telles quelles. Le décodage reste en
//! `greedy_search`, et rien n'entre dans le prompt du modèle de langage.
//!
//! Repris et adapté d'Umless (github.com/jatinbishla/Umless, Apache-2.0,
//! `crates/umless-cleanup/src/dictionary.rs`, commit ded641f) : format du
//! fichier, fenêtre d'un mot de plus ou de moins, budget d'édition
//! proportionnel à la longueur, et la garde « le même terme colle mieux un mot
//! plus loin ». Changé pour le français :
//! - clé phonétique française (`ch`, `qu`, `c` et `g` doux, `gn`, `x`, `h`
//!   muet…) au lieu d'un squelette anglais. On compare le premier *son*, pas la
//!   première lettre : « Kwen » devient « Qwen » ;
//! - élisions : « qu'en » n'est pas « Qwen », et « l'Olama » devient
//!   « l'Ollama » ;
//! - accents repliés, flexions françaises (pluriel, féminin) laissées telles
//!   quelles ;
//! - un terme que la reconnaissance a coupé ou collé (« Cat Desk ») doit
//!   s'écrire presque pareil une fois recollé. Ainsi « une super base »
//!   reste une super base, sauf variante explicite.

use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use crate::core::error::CatdeskError;

#[cfg(test)]
pub(crate) mod corpus;
#[cfg(test)]
mod tests;

/// Nom du fichier, rangé sous `<données>/voice/`.
pub const FILE_NAME: &str = "vocabulaire.txt";
/// Un vocabulaire, pas un dictionnaire de langue.
pub const MAX_BYTES: usize = 32 * 1024;
pub const MAX_ENTRIES: usize = 500;
const MAX_LINE_CHARS: usize = 200;

/// Éditions permises par lettre du terme (arrondi bas), quand le son colle.
const MAX_EDIT_SHARE: f32 = 0.34;
/// À partir de cette longueur, un terme peut perdre ou gagner une consonne.
const LONG_TERM: usize = 8;
/// En dessous, un terme ne se corrige que par ses variantes « = ».
const MIN_LETTERS: usize = 3;

/// Préfixes élidés du français, repliés : « qu'en » n'est pas « Qwen ».
const ELISIONS: [&str; 13] = [
    "l", "d", "j", "m", "n", "s", "t", "c", "qu", "jusqu", "lorsqu", "puisqu", "quoiqu",
];

#[derive(Debug, Clone, Default)]
pub struct Vocabulary {
    /// Les plus longs d'abord : « Sup de Vinci » passe avant « Vinci ».
    terms: Vec<Term>,
    /// Les suites les plus longues d'abord.
    aliases: Vec<Alias>,
}

#[derive(Debug, Clone)]
struct Term {
    text: String,
    words: usize,
    letters: String,
    sound: String,
}

/// « Supabase = supa base » : la suite de mots entendue (repliée) → le terme.
#[derive(Debug, Clone)]
struct Alias {
    heard: Vec<String>,
    term: String,
}

/// Ce que l'UI affiche après un chargement.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Summary {
    /// Entrées distinctes (un terme, avec ou sans variantes).
    pub terms: usize,
    /// Variantes « = ».
    pub aliases: usize,
    /// Lignes ignorées et pourquoi, en français.
    pub problems: Vec<String>,
}

impl Vocabulary {
    /// Un terme par ligne. « Terme = entendu, entendu » liste aussi ce que la
    /// reconnaissance écrit à sa place. Lignes vides et commentaires `#`
    /// ignorés. Ne refuse rien : ce qui ne sert pas est signalé dans le résumé.
    pub fn parse(text: &str) -> (Self, Summary) {
        let mut terms: Vec<Term> = Vec::new();
        let mut aliases: Vec<Alias> = Vec::new();
        let mut names: Vec<String> = Vec::new();
        let mut problems = Vec::new();
        let mut entries = 0usize;

        for (n, raw) in text.lines().enumerate() {
            let line = strip_comment(raw).trim();
            if line.is_empty() {
                continue;
            }
            if line.chars().count() > MAX_LINE_CHARS {
                problems.push(format!(
                    "Ligne {} ignorée : plus de {MAX_LINE_CHARS} caractères.",
                    n + 1
                ));
                continue;
            }
            if entries == MAX_ENTRIES {
                problems.push(format!(
                    "Au-delà de {MAX_ENTRIES} entrées, le reste est ignoré."
                ));
                break;
            }
            entries += 1;

            let (term, heard) = match line.split_once('=') {
                Some((t, h)) => (t, Some(h)),
                None => (line, None),
            };
            let term = term.split_whitespace().collect::<Vec<_>>().join(" ");
            if term.is_empty() {
                problems.push(format!("Ligne {} ignorée : rien avant « = ».", n + 1));
                continue;
            }

            let mut own_aliases = 0;
            for h in heard.unwrap_or("").split(',') {
                let words: Vec<String> = h
                    .split_whitespace()
                    .map(alias_word)
                    .filter(|w| !w.is_empty())
                    .collect();
                // « Ollama = a » réécrirait chaque « a » de chaque phrase.
                if let [word] = words.as_slice() {
                    if letters(word).chars().count() < MIN_LETTERS {
                        problems.push(format!(
                            "Ligne {} : variante « {} » ignorée, un mot de moins de {MIN_LETTERS} lettres serait remplacé partout.",
                            n + 1,
                            h.trim()
                        ));
                        continue;
                    }
                }
                if !words.is_empty() {
                    aliases.push(Alias {
                        heard: words,
                        term: term.clone(),
                    });
                    own_aliases += 1;
                }
            }

            let letters = letters(&term);
            if letters.chars().count() >= MIN_LETTERS {
                if !terms.iter().any(|t| t.text == term) {
                    terms.push(Term {
                        words: term.split_whitespace().count(),
                        sound: sound(&letters),
                        letters,
                        text: term.clone(),
                    });
                }
            } else if own_aliases == 0 {
                problems.push(format!(
                    "« {term} » : trop court pour être reconnu seul. Ajoute après « = » ce que la voix écrit à sa place."
                ));
                continue;
            }
            if !names.contains(&term) {
                names.push(term);
            }
        }

        terms.sort_by_key(|t| std::cmp::Reverse(t.letters.chars().count()));
        aliases.sort_by_key(|a| std::cmp::Reverse(a.heard.len()));
        let summary = Summary {
            terms: names.len(),
            aliases: aliases.len(),
            problems,
        };
        (Self { terms, aliases }, summary)
    }

    pub fn is_empty(&self) -> bool {
        self.terms.is_empty() && self.aliases.is_empty()
    }

    /// Réécrit les variantes connues et les quasi-homophones des termes.
    /// Sans rien à réécrire, le texte revient tel quel.
    pub fn apply(&self, text: &str) -> String {
        if self.is_empty() || text.trim().is_empty() {
            return text.to_string();
        }
        let after_aliases = self.apply_aliases(text);
        let text = after_aliases.as_deref().unwrap_or(text);
        match self.apply_terms(text) {
            Some(rewritten) => rewritten,
            None => text.to_string(),
        }
    }

    /// Chaque suite « entendue » devient son terme, ponctuation autour gardée.
    fn apply_aliases(&self, text: &str) -> Option<String> {
        if self.aliases.is_empty() {
            return None;
        }
        let toks: Vec<Tok> = text.split_whitespace().map(Tok::new).collect();
        let keys: Vec<String> = toks.iter().map(|t| alias_word(t.core)).collect();
        let mut out: Vec<String> = Vec::with_capacity(toks.len());
        let mut changed = false;
        let mut i = 0;
        'next: while i < toks.len() {
            for alias in &self.aliases {
                let n = alias.heard.len();
                if i + n <= toks.len()
                    && keys[i..i + n] == alias.heard[..]
                    && !broken(&toks[i..i + n])
                {
                    out.push(respell(&toks[i..i + n], &alias.term));
                    changed = true;
                    i += n;
                    continue 'next;
                }
            }
            out.push(toks[i].raw.to_string());
            i += 1;
        }
        changed.then(|| out.join(" "))
    }

    /// Quasi-homophones : pour chaque position, le terme le plus proche.
    fn apply_terms(&self, text: &str) -> Option<String> {
        if self.terms.is_empty() {
            return None;
        }
        let toks: Vec<Tok> = text.split_whitespace().map(Tok::new).collect();
        let mut out: Vec<String> = Vec::with_capacity(toks.len());
        let mut changed = false;
        let mut i = 0;
        while i < toks.len() {
            match self.best_at(&toks, i) {
                // Si le même terme colle mieux un mot plus loin, ce mot-ci
                // n'en fait pas partie (repris d'Umless).
                Some(m)
                    if !self
                        .best_at(&toks, i + 1)
                        .is_some_and(|next| next.term == m.term && next.edits < m.edits) =>
                {
                    let window = &toks[i..i + m.len];
                    let word = respell(window, &self.terms[m.term].text);
                    let before: Vec<&str> = window.iter().map(|t| t.raw).collect();
                    if word != before.join(" ") {
                        changed = true;
                    }
                    out.push(word);
                    i += m.len;
                }
                _ => {
                    out.push(toks[i].raw.to_string());
                    i += 1;
                }
            }
        }
        changed.then(|| out.join(" "))
    }

    /// Le terme le plus proche à partir du mot `i` : le moins d'éditions, puis
    /// le plus long (les termes sont triés du plus long au plus court).
    fn best_at(&self, toks: &[Tok], i: usize) -> Option<Match> {
        let mut best: Option<Match> = None;
        for (t, term) in self.terms.iter().enumerate() {
            // La reconnaissance coupe parfois un terme (« Ken Saku ») ou en
            // colle deux mots.
            for len in [term.words, term.words + 1, term.words.saturating_sub(1)] {
                if len == 0 || i + len > toks.len() {
                    continue;
                }
                let window = &toks[i..i + len];
                if broken(window) {
                    continue;
                }
                let said: String = window.iter().map(|w| w.letters.as_str()).collect();
                if let Some(edits) = edits_to(term, &said, len == term.words) {
                    if best.map_or(true, |b| edits < b.edits) {
                        best = Some(Match {
                            term: t,
                            len,
                            edits,
                        });
                    }
                }
            }
        }
        best
    }
}

#[derive(Debug, Clone, Copy)]
struct Match {
    term: usize,
    /// Mots de la transcription couverts.
    len: usize,
    edits: usize,
}

/// Un mot de la transcription : ponctuation et élision devant, le mot, la
/// ponctuation derrière.
struct Tok<'a> {
    raw: &'a str,
    /// Ponctuation ouvrante et élision (« l' », « qu' »).
    lead: &'a str,
    core: &'a str,
    trail: &'a str,
    letters: String,
}

impl<'a> Tok<'a> {
    fn new(raw: &'a str) -> Self {
        let start = raw.find(char::is_alphanumeric).unwrap_or(raw.len());
        let end = raw[start..]
            .char_indices()
            .rev()
            .find(|(_, c)| c.is_alphanumeric())
            .map_or(start, |(i, c)| start + i + c.len_utf8());
        let mut core_start = start;
        // Élision : « l'Olama » → « l' » + « Olama ». « aujourd'hui » reste entier.
        if let Some((pos, apostrophe)) = raw[start..end]
            .char_indices()
            .rev()
            .find(|(_, c)| matches!(c, '\'' | '’'))
        {
            if ELISIONS.contains(&fold(&raw[start..start + pos]).as_str()) {
                core_start = start + pos + apostrophe.len_utf8();
            }
        }
        let core = &raw[core_start..end];
        Self {
            raw,
            lead: &raw[..core_start],
            core,
            trail: &raw[end..],
            letters: letters(core),
        }
    }
}

/// Une ponctuation (ou une élision) à l'intérieur de la fenêtre : ces mots
/// ne forment pas un seul terme.
fn broken(window: &[Tok]) -> bool {
    window[..window.len() - 1]
        .iter()
        .any(|t| !t.trail.is_empty())
        || window[1..].iter().any(|t| !t.lead.is_empty())
}

/// Éditions de lettres de `said` vers le terme, si c'est une écoute plausible.
/// `same_words` : la fenêtre a autant de mots que le terme.
fn edits_to(term: &Term, said: &str, same_words: bool) -> Option<usize> {
    if said == term.letters {
        return Some(0); // seules la casse, les accents ou les espaces diffèrent
    }
    // Une flexion du terme est un autre mot : « des Nexus », « les parakeets ».
    if let Some(rest) = said.strip_prefix(term.letters.as_str()) {
        if matches!(rest, "s" | "x" | "e" | "es" | "ent") {
            return None;
        }
    }
    let heard = sound(said);
    if heard.chars().next() != term.sound.chars().next() {
        return None;
    }
    let letters = term.letters.chars().count();
    let sound_slack = usize::from(letters >= LONG_TERM);
    if levenshtein(&heard, &term.sound) > sound_slack {
        return None;
    }
    // Coupé ou collé par la reconnaissance, un terme garde son orthographe :
    // « Cat Desk », « Supa base ». Pas « super base ».
    let allowed = if same_words {
        ((letters as f32 * MAX_EDIT_SHARE) as usize).max(1)
    } else {
        1
    };
    let edits = levenshtein(said, &term.letters);
    (edits <= allowed).then_some(edits)
}

/// Le terme à la place de la fenêtre, avec la ponctuation autour et une
/// majuscule de début de phrase (repris d'Umless).
fn respell(window: &[Tok], term: &str) -> String {
    let first = &window[0];
    let last = &window[window.len() - 1];
    let mut t = term.to_string();
    // « Olama, viens » en début de phrase : la majuscule reste. TOUT EN
    // CAPITALES n'est que du bruit de reconnaissance.
    let mut alpha = first.core.chars().filter(|c| c.is_alphabetic());
    let title_case = alpha.next().is_some_and(char::is_uppercase)
        && (first.core.chars().filter(|c| c.is_alphabetic()).count() == 1
            || alpha.any(char::is_lowercase));
    if title_case {
        let mut chars = t.chars();
        if let Some(f) = chars.next() {
            t = f.to_uppercase().chain(chars).collect();
        }
    }
    format!("{}{t}{}", first.lead, last.trail)
}

/// Clé d'une variante « = » ou d'un mot entendu : replié, sans ponctuation
/// autour.
fn alias_word(w: &str) -> String {
    fold(w.trim_matches(|c: char| !c.is_alphanumeric()))
}

/// Minuscules sans accents : « Maëlle » → « maelle ». Le « ç » devient « s »,
/// le son qu'il note (« c » seul serait dur devant a, o, u).
fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars().flat_map(char::to_lowercase) {
        match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => out.push('a'),
            'ç' => out.push('s'),
            'è' | 'é' | 'ê' | 'ë' => out.push('e'),
            'ì' | 'í' | 'î' | 'ï' => out.push('i'),
            'ñ' => out.push('n'),
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' => out.push('o'),
            'ù' | 'ú' | 'û' | 'ü' => out.push('u'),
            'ý' | 'ÿ' => out.push('y'),
            'œ' => out.push_str("oe"),
            'æ' => out.push_str("ae"),
            'ß' => out.push_str("ss"),
            c => out.push(c),
        }
    }
    out
}

/// Lettres et chiffres seulement, repliés.
fn letters(s: &str) -> String {
    fold(s).chars().filter(|c| c.is_alphanumeric()).collect()
}

/// Squelette sonore français, grossier : le premier son (toute voyelle
/// initiale vaut « a »), puis les consonnes, graphies équivalentes fondues et
/// répétitions écrasées. « Ollama », « Olama » et « Oh lama » donnent « alm » ;
/// « Qwen », « Quen » et « Kwen » donnent « kn ».
fn sound(letters: &str) -> String {
    const VOWEL: char = '*';
    let c: Vec<char> = letters.chars().collect();
    let soft = |x: Option<&char>| matches!(x, Some('e' | 'i' | 'y'));
    let mut syms: Vec<char> = Vec::with_capacity(c.len() + 2);
    let mut i = 0;
    while i < c.len() {
        let next = c.get(i + 1);
        let (sym, step): (&[char], usize) = match c[i] {
            'p' if next == Some(&'h') => (&['f'], 2),
            't' if next == Some(&'h') => (&['t'], 2),
            's' if next == Some(&'c') && c.get(i + 2) == Some(&'h') => (&['x'], 3),
            'c' | 's' if next == Some(&'h') => (&['x'], 2),
            'c' if next == Some(&'k') => (&['k'], 2),
            'q' if next == Some(&'u') => (&['k'], 2),
            'q' | 'k' => (&['k'], 1),
            'c' if soft(next) => (&['s'], 1),
            'c' => (&['k'], 1),
            'g' if next == Some(&'u') && soft(c.get(i + 2)) => (&['g'], 2),
            'g' if next == Some(&'n') => (&['n'], 2),
            'g' if soft(next) => (&['j'], 1),
            'x' => (&['k', 's'], 1),
            'z' => (&['s'], 1),
            'h' => (&[], 1),
            'a' | 'e' | 'i' | 'o' | 'u' | 'y' | 'w' => (&[VOWEL], 1),
            other => {
                syms.push(other);
                i += 1;
                continue;
            }
        };
        syms.extend_from_slice(sym);
        i += step;
    }
    let mut out = String::new();
    for (k, s) in syms.into_iter().enumerate() {
        if s == VOWEL {
            // Seule une voyelle initiale compte, et toutes se valent.
            if k == 0 {
                out.push('a');
            }
        } else if !out.ends_with(s) {
            out.push(s);
        }
    }
    out
}

fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut cur = Vec::with_capacity(b.len() + 1);
        cur.push(i + 1);
        for (j, cb) in b.iter().enumerate() {
            cur.push(
                (prev[j] + usize::from(ca != cb))
                    .min(prev[j + 1] + 1)
                    .min(cur[j] + 1),
            );
        }
        prev = cur;
    }
    prev[b.len()]
}

/// `#` commence un commentaire en début de ligne ou après une espace :
/// « C# = c sharp » reste une entrée.
fn strip_comment(line: &str) -> &str {
    let mut prev_space = true;
    for (i, c) in line.char_indices() {
        if c == '#' && prev_space {
            return &line[..i];
        }
        prev_space = c.is_whitespace();
    }
    line
}

// ─── Fichier et vocabulaire en service ──────────────────────────────────

/// `<données>/voice/vocabulaire.txt`.
pub fn file_path(data_dir: &Path) -> PathBuf {
    data_dir.join("voice").join(FILE_NAME)
}

/// Refuse ce qui n'est pas un vocabulaire : trop long, caractères de contrôle.
pub fn validate(text: &str) -> Result<(), CatdeskError> {
    if text.len() > MAX_BYTES {
        return Err(CatdeskError::Refused(format!(
            "Vocabulaire trop long : {} Ko au plus.",
            MAX_BYTES / 1024
        )));
    }
    if text
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(CatdeskError::Refused(
            "Le vocabulaire contient des caractères de contrôle.".into(),
        ));
    }
    Ok(())
}

/// Le vocabulaire en service, partagé entre les commandes (qui le
/// remplacent) et la reconnaissance (qui le lit à chaque transcription).
#[derive(Clone)]
pub struct VocabularyCell {
    inner: Arc<RwLock<CellState>>,
}

struct CellState {
    vocabulary: Arc<Vocabulary>,
    summary: Summary,
    enabled: bool,
    path: Option<PathBuf>,
}

impl Default for VocabularyCell {
    /// Vide, activé, sans fichier (tests, banc).
    fn default() -> Self {
        Self::from_text(None, "")
    }
}

impl VocabularyCell {
    /// Lit le fichier s'il existe. Un fichier modifié à la main au-delà des
    /// bornes n'est lu que jusqu'à [`MAX_BYTES`].
    pub fn load(path: Option<PathBuf>) -> Self {
        let text = path
            .as_deref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .unwrap_or_default();
        let mut end = text.len().min(MAX_BYTES);
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        Self::from_text(path, &text[..end])
    }

    pub fn from_text(path: Option<PathBuf>, text: &str) -> Self {
        let (vocabulary, summary) = Vocabulary::parse(text);
        Self {
            inner: Arc::new(RwLock::new(CellState {
                vocabulary: Arc::new(vocabulary),
                summary,
                enabled: true,
                path,
            })),
        }
    }

    /// Le texte corrigé, ou tel quel si la correction est coupée.
    pub fn correct(&self, text: &str) -> String {
        let vocabulary = {
            let s = self.inner.read().expect("vocabulary lock");
            if !s.enabled {
                return text.to_string();
            }
            s.vocabulary.clone()
        };
        vocabulary.apply(text)
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.inner.write().expect("vocabulary lock").enabled = enabled;
    }

    pub fn summary(&self) -> Summary {
        self.inner.read().expect("vocabulary lock").summary.clone()
    }

    pub fn path(&self) -> Option<PathBuf> {
        self.inner.read().expect("vocabulary lock").path.clone()
    }

    /// Le fichier tel qu'écrit (vide s'il n'existe pas encore).
    pub fn read_text(&self) -> Result<String, CatdeskError> {
        let Some(path) = self.path() else {
            return Ok(String::new());
        };
        match std::fs::read_to_string(&path) {
            Ok(text) => Ok(text),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
            Err(e) => Err(CatdeskError::Io(e.to_string())),
        }
    }

    /// Vérifie, écrit le fichier (atomiquement) puis met le nouveau
    /// vocabulaire en service.
    pub fn save(&self, text: &str) -> Result<Summary, CatdeskError> {
        validate(text)?;
        let path = self.path().ok_or_else(|| {
            CatdeskError::Refused(
                "Dossier de données introuvable : vocabulaire non enregistré.".into(),
            )
        })?;
        write_atomic(&path, text)?;
        let (vocabulary, summary) = Vocabulary::parse(text);
        let mut s = self.inner.write().expect("vocabulary lock");
        s.vocabulary = Arc::new(vocabulary);
        s.summary = summary.clone();
        Ok(summary)
    }
}

/// Fichier temporaire puis renommage : jamais un vocabulaire à moitié écrit.
fn write_atomic(path: &Path, text: &str) -> Result<(), CatdeskError> {
    let io = |e: std::io::Error| CatdeskError::Io(e.to_string());
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(io)?;
    }
    let tmp = path.with_extension("txt.tmp");
    std::fs::write(&tmp, text).map_err(io)?;
    std::fs::rename(&tmp, path).map_err(io)
}
