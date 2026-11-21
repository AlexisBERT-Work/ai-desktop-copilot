//! Dictée — taper le texte reconnu dans la fenêtre qui avait le focus à
//! l'appui du raccourci, dans n'importe quelle application.
//!
//! Le texte part en **frappes Unicode** (`SendInput` + `KEYEVENTF_UNICODE`) :
//! le presse-papier n'est jamais touché, et la disposition du clavier
//! (AZERTY, BÉPO…) ne compte pas. Avant de taper, trois vérifications :
//! - la fenêtre au premier plan est **toujours** celle de l'appui — sinon le
//!   texte finirait ailleurs que là où l'utilisateur parlait ;
//! - Ctrl et Alt sont **physiquement relâchés** — sinon chaque lettre
//!   deviendrait un raccourci (Ctrl+Alt+E = « € » en AZERTY, etc.) ;
//! - la fenêtre n'appartient pas à un programme **plus élevé** que CatDesk
//!   (lancé en administrateur) : Windows y bloque la frappe sans le dire
//!   (UIPI), on préfère le dire nous-mêmes.
//!
//! Aucun retour à la ligne n'est tapé : Entrée enverrait le message dans
//! Discord ou Teams avant que l'utilisateur ait relu.
//!
//! La partie pure (nettoyage, frappes UTF-16, décision) est testée ici ; la
//! partie Win32 est dans [`win`].

use std::time::{Duration, Instant};

use serde::Serialize;

/// Délai laissé à l'utilisateur pour lâcher Ctrl et Alt après Espace.
const MODIFIERS_TIMEOUT: Duration = Duration::from_secs(5);
const MODIFIERS_POLL: Duration = Duration::from_millis(10);

/// Fenêtre qui avait le focus à l'appui du raccourci. Poignée Win32 rangée
/// en entier : un `HWND` (pointeur) ne traverse pas les threads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Target(pub isize);

/// Issue d'une dictée — publiée à la pastille et notée dans l'audit. Miroir
/// de `VoiceDictationOutcome` (`shared-types/src/voice.ts`, vérifié par test).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    /// Texte tapé dans la fenêtre d'origine.
    Inserted,
    /// Rien d'audible, ou rien de reconnu : rien n'est tapé.
    Empty,
    /// La fenêtre au premier plan n'est plus celle de l'appui.
    FocusChanged,
    /// Fenêtre d'un programme plus élevé que CatDesk (administrateur), ou
    /// dont le niveau est illisible : refus net.
    Elevated,
    /// Ctrl ou Alt encore tenus après [`MODIFIERS_TIMEOUT`].
    KeysHeld,
    /// Windows a refusé une partie des frappes.
    Blocked,
    /// Modèles de reconnaissance absents : le micro ne s'ouvre pas.
    NoModels,
    /// Micro impossible à ouvrir.
    MicError,
    /// La bulle transcrivait une question : appui ignoré.
    Busy,
}

impl Outcome {
    #[cfg(test)]
    pub const ALL: [Outcome; 9] = [
        Outcome::Inserted,
        Outcome::Empty,
        Outcome::FocusChanged,
        Outcome::Elevated,
        Outcome::KeysHeld,
        Outcome::Blocked,
        Outcome::NoModels,
        Outcome::MicError,
        Outcome::Busy,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Inserted => "inserted",
            Outcome::Empty => "empty",
            Outcome::FocusChanged => "focus_changed",
            Outcome::Elevated => "elevated",
            Outcome::KeysHeld => "keys_held",
            Outcome::Blocked => "blocked",
            Outcome::NoModels => "no_models",
            Outcome::MicError => "mic_error",
            Outcome::Busy => "busy",
        }
    }
}

/// Résultat de [`insert`] : l'issue, le nombre de caractères reconnus (tapés
/// si `Inserted`) et l'attente du relâchement de Ctrl/Alt.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Report {
    pub outcome: Outcome,
    pub chars: usize,
    pub wait_ms: u128,
}

/// Étape publiée sur `voice:dictation`, pour la pastille.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DictationPhase {
    Recording,
    Transcribing,
    Done,
}

/// Charge utile de `voice:dictation` — miroir de `VoiceDictationEvent`.
/// Jamais le texte : la pastille n'affiche que le nombre de caractères.
#[derive(Clone, Copy, Debug, Serialize)]
pub struct DictationEvent {
    pub phase: DictationPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<Outcome>,
    pub chars: usize,
}

/// Texte prêt à taper : ni retour à la ligne, ni tabulation (elle changerait
/// de champ), ni caractère de contrôle ; espaces resserrées, bords coupés.
pub fn sanitize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pending_space = false;
    for c in text.chars() {
        if c.is_whitespace() || c.is_control() {
            pending_space = !out.is_empty();
            continue;
        }
        if pending_space {
            out.push(' ');
            pending_space = false;
        }
        out.push(c);
    }
    out
}

/// Assemble les prises de parole transcrites une à une : une espace entre
/// deux, aucune vide.
pub fn join_segments<I, S>(parts: I) -> String
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    parts
        .into_iter()
        .map(|p| p.as_ref().trim().to_string())
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Une frappe Unicode : une unité UTF-16, appuyée ou relâchée.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KeyStroke {
    pub unit: u16,
    pub up: bool,
}

/// Appui puis relâchement pour chaque unité UTF-16 : un caractère hors du
/// plan de base (emoji) part en paire de substitution, que l'application
/// recompose — c'est ce que fait le clavier tactile de Windows.
pub fn key_strokes(text: &str) -> Vec<KeyStroke> {
    text.encode_utf16()
        .flat_map(|unit| [KeyStroke { unit, up: false }, KeyStroke { unit, up: true }])
        .collect()
}

/// Décision pure : peut-on taper `text` dans `foreground` ?
///
/// `target_integrity` / `own_integrity` : RID du niveau d'intégrité (0x2000
/// moyen, 0x3000 élevé…). `None` = illisible — le jeton d'un programme
/// élevé refuse justement de se laisser lire : on refuse aussi.
pub fn decide(
    text: &str,
    target: Target,
    foreground: Target,
    target_integrity: Option<u32>,
    own_integrity: Option<u32>,
) -> Result<(), Outcome> {
    if text.is_empty() {
        return Err(Outcome::Empty);
    }
    if target.0 == 0 || foreground != target {
        return Err(Outcome::FocusChanged);
    }
    match (target_integrity, own_integrity) {
        (Some(t), Some(own)) if t <= own => Ok(()),
        _ => Err(Outcome::Elevated),
    }
}

/// Fenêtre au premier plan, à figer à l'appui du raccourci.
pub fn foreground() -> Target {
    win::foreground()
}

/// À l'appui : une frappe neutre (VK 0xE8, non attribuée) pour que le
/// relâchement d'Alt n'active pas la barre de menus de l'application.
pub fn send_menu_mask() {
    win::send_menu_mask();
}

/// Attend le relâchement de Ctrl/Alt, vérifie la fenêtre, tape le texte.
/// Bloquant (jusqu'à [`MODIFIERS_TIMEOUT`]) : à lancer hors du thread d'écoute.
pub fn insert(text: &str, target: Target) -> Report {
    let text = sanitize(text);
    let chars = text.chars().count();
    let report = |outcome, wait_ms| Report {
        outcome,
        chars,
        wait_ms,
    };
    if text.is_empty() {
        return report(Outcome::Empty, 0);
    }

    let waiting = Instant::now();
    while win::modifiers_down() {
        if waiting.elapsed() >= MODIFIERS_TIMEOUT {
            return report(Outcome::KeysHeld, waiting.elapsed().as_millis());
        }
        std::thread::sleep(MODIFIERS_POLL);
    }
    let wait_ms = waiting.elapsed().as_millis();

    let foreground = win::foreground();
    if let Err(outcome) = decide(
        &text,
        target,
        foreground,
        win::window_integrity(target),
        win::own_integrity(),
    ) {
        return report(outcome, wait_ms);
    }
    let (sent, total) = win::type_text(&text);
    if sent < total {
        return report(Outcome::Blocked, wait_ms);
    }
    report(Outcome::Inserted, wait_ms)
}

#[cfg(windows)]
mod win {
    use std::mem::size_of;
    use std::ptr::null_mut;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, HWND};
    use windows_sys::Win32::Security::{
        GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TokenIntegrityLevel,
        TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        KEYEVENTF_UNICODE, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    use super::{key_strokes, Target};

    /// Touche virtuelle non attribuée, l'usage établi pour « masquer » Alt.
    const VK_MENU_MASK: u16 = 0xE8;

    pub fn foreground() -> Target {
        // SAFETY : aucun argument ; renvoie NULL s'il n'y a pas de fenêtre active.
        Target(unsafe { GetForegroundWindow() } as isize)
    }

    /// Une touche qui transformerait la frappe en raccourci est-elle tenue ?
    pub fn modifiers_down() -> bool {
        [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN]
            .into_iter()
            // SAFETY : lecture d'état clavier, sans pointeur.
            .any(|vk| unsafe { GetAsyncKeyState(i32::from(vk)) } as u16 & 0x8000 != 0)
    }

    fn key(vk: u16, scan: u16, flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: scan,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn send(inputs: &[INPUT]) -> usize {
        if inputs.is_empty() {
            return 0;
        }
        // SAFETY : tableau valide de `inputs.len()` INPUT initialisés.
        unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                size_of::<INPUT>() as i32,
            ) as usize
        }
    }

    pub fn send_menu_mask() {
        send(&[
            key(VK_MENU_MASK, 0, 0),
            key(VK_MENU_MASK, 0, KEYEVENTF_KEYUP),
        ]);
    }

    /// Tape `text` en un seul `SendInput` : atomique, aucune frappe réelle de
    /// l'utilisateur ne s'intercale. Renvoie (frappes acceptées, demandées).
    pub fn type_text(text: &str) -> (usize, usize) {
        let inputs: Vec<INPUT> = key_strokes(text)
            .into_iter()
            .map(|k| {
                let up = if k.up { KEYEVENTF_KEYUP } else { 0 };
                key(0, k.unit, KEYEVENTF_UNICODE | up)
            })
            .collect();
        (send(&inputs), inputs.len())
    }

    /// RID du niveau d'intégrité d'un processus (dernière sous-autorité du
    /// SID du label). `None` si le jeton ne se laisse pas lire.
    fn integrity_of(process: HANDLE) -> Option<u32> {
        let mut token: HANDLE = null_mut();
        // SAFETY : `process` est un handle valide ; `token` reçoit le jeton.
        if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) } == 0 {
            return None;
        }
        let mut len = 0u32;
        // SAFETY : premier appel pour connaître la taille (échec attendu).
        unsafe { GetTokenInformation(token, TokenIntegrityLevel, null_mut(), 0, &mut len) };
        // u64 : le label contient un pointeur, le tampon doit être aligné.
        let mut buf = vec![0u64; (len as usize).div_ceil(8).max(1)];
        // SAFETY : tampon de `len` octets au moins, aligné sur 8.
        let ok = unsafe {
            GetTokenInformation(
                token,
                TokenIntegrityLevel,
                buf.as_mut_ptr().cast(),
                len,
                &mut len,
            )
        };
        // SAFETY : handle ouvert ci-dessus.
        unsafe { CloseHandle(token) };
        if ok == 0 {
            return None;
        }
        // SAFETY : GetTokenInformation a rempli un TOKEN_MANDATORY_LABEL ; le
        // SID pointe dans `buf`, encore vivant.
        unsafe {
            let label = &*(buf.as_ptr() as *const TOKEN_MANDATORY_LABEL);
            let count = *GetSidSubAuthorityCount(label.Label.Sid);
            if count == 0 {
                return None;
            }
            Some(*GetSidSubAuthority(label.Label.Sid, u32::from(count) - 1))
        }
    }

    pub fn own_integrity() -> Option<u32> {
        // SAFETY : pseudo-handle du processus courant, à ne pas fermer.
        integrity_of(unsafe { GetCurrentProcess() })
    }

    pub fn window_integrity(target: Target) -> Option<u32> {
        let mut pid = 0u32;
        // SAFETY : `pid` reçoit l'identifiant ; une poignée périmée donne 0.
        unsafe { GetWindowThreadProcessId(target.0 as HWND, &mut pid) };
        if pid == 0 {
            return None;
        }
        // SAFETY : accès minimal, accordé même pour un processus élevé.
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if process.is_null() {
            return None;
        }
        let level = integrity_of(process);
        // SAFETY : handle ouvert ci-dessus.
        unsafe { CloseHandle(process) };
        level
    }
}

/// Hors Windows, la dictée ne tape rien (aucune fenêtre cible) : CatDesk ne
/// vise que Windows, ceci garde juste la compilation possible ailleurs.
#[cfg(not(windows))]
mod win {
    use super::Target;

    pub fn foreground() -> Target {
        Target(0)
    }
    pub fn modifiers_down() -> bool {
        false
    }
    pub fn send_menu_mask() {}
    pub fn type_text(_text: &str) -> (usize, usize) {
        (0, 0)
    }
    pub fn own_integrity() -> Option<u32> {
        None
    }
    pub fn window_integrity(_target: Target) -> Option<u32> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MEDIUM: u32 = 0x2000;
    const HIGH: u32 = 0x3000;
    const W: Target = Target(0x1234);

    #[test]
    fn aucun_retour_a_la_ligne_ni_tabulation_n_est_tape() {
        assert_eq!(
            sanitize("  Bonjour,\nje suis\tlà.\r\n "),
            "Bonjour, je suis là."
        );
        assert_eq!(sanitize("a\u{0007}b\u{001b}[0mc"), "a b [0mc");
        assert_eq!(sanitize("\n\t "), "");
        // L'espace insécable devient une espace simple, le reste est intact.
        assert_eq!(sanitize("Prix\u{00a0}: 12 €"), "Prix : 12 €");
    }

    #[test]
    fn les_segments_sont_joints_par_une_espace() {
        assert_eq!(
            join_segments(["Bonjour.", "  ", "Je voudrais un café. ", ""]),
            "Bonjour. Je voudrais un café."
        );
        assert_eq!(join_segments(Vec::<String>::new()), "");
    }

    #[test]
    fn une_frappe_par_unite_utf16_appui_puis_relachement() {
        let k = key_strokes("é");
        assert_eq!(
            k,
            vec![
                KeyStroke {
                    unit: 0x00e9,
                    up: false
                },
                KeyStroke {
                    unit: 0x00e9,
                    up: true
                },
            ]
        );
        // Emoji hors plan de base : paire de substitution, dans l'ordre.
        let units: Vec<u16> = key_strokes("👍").iter().map(|k| k.unit).collect();
        assert_eq!(units, vec![0xd83d, 0xd83d, 0xdc4d, 0xdc4d]);
        // Accents, œ, guillemets : autant de paires que d'unités UTF-16.
        let text = "« Où est l'œuvre ? » 👨\u{200d}👩\u{200d}👧";
        assert_eq!(key_strokes(text).len(), text.encode_utf16().count() * 2);
        let rebuilt: Vec<u16> = key_strokes(text)
            .iter()
            .filter(|k| !k.up)
            .map(|k| k.unit)
            .collect();
        assert_eq!(String::from_utf16(&rebuilt).unwrap(), text);
    }

    #[test]
    fn on_tape_dans_la_meme_fenetre_au_meme_niveau() {
        assert_eq!(decide("ok", W, W, Some(MEDIUM), Some(MEDIUM)), Ok(()));
        // Une fenêtre moins élevée (navigateur en bac à sable) aussi.
        assert_eq!(decide("ok", W, W, Some(0x1000), Some(MEDIUM)), Ok(()));
    }

    #[test]
    fn rien_n_est_tape_ailleurs_ni_vers_plus_eleve() {
        assert_eq!(
            decide("", W, W, Some(MEDIUM), Some(MEDIUM)),
            Err(Outcome::Empty)
        );
        assert_eq!(
            decide("ok", W, Target(0x9999), Some(MEDIUM), Some(MEDIUM)),
            Err(Outcome::FocusChanged)
        );
        // Pas de fenêtre active à l'appui (bureau sécurisé, verrouillage).
        assert_eq!(
            decide("ok", Target(0), Target(0), Some(MEDIUM), Some(MEDIUM)),
            Err(Outcome::FocusChanged)
        );
        assert_eq!(
            decide("ok", W, W, Some(HIGH), Some(MEDIUM)),
            Err(Outcome::Elevated)
        );
        // Jeton illisible : c'est justement le cas d'un programme élevé.
        assert_eq!(
            decide("ok", W, W, None, Some(MEDIUM)),
            Err(Outcome::Elevated)
        );
        assert_eq!(
            decide("ok", W, W, Some(MEDIUM), None),
            Err(Outcome::Elevated)
        );
    }

    #[test]
    fn un_texte_vide_ne_touche_a_rien() {
        let r = insert(" \n ", W);
        assert_eq!(
            r,
            Report {
                outcome: Outcome::Empty,
                chars: 0,
                wait_ms: 0
            }
        );
    }

    #[test]
    fn issues_identiques_au_miroir_typescript() {
        let ts = include_str!("../../../../../../packages/shared-types/src/voice.ts");
        for outcome in Outcome::ALL {
            let json = serde_json::to_string(&outcome).unwrap();
            assert_eq!(json, format!("\"{}\"", outcome.as_str()));
            assert!(
                ts.contains(&format!("'{}'", outcome.as_str())),
                "issue absente de VoiceDictationOutcome : {}",
                outcome.as_str()
            );
        }
        for phase in [
            DictationPhase::Recording,
            DictationPhase::Transcribing,
            DictationPhase::Done,
        ] {
            let json = serde_json::to_string(&phase).unwrap();
            assert!(
                ts.contains(&json.replace('"', "'")),
                "étape absente de VoiceDictationPhase : {json}"
            );
        }
        let event = DictationEvent {
            phase: DictationPhase::Recording,
            outcome: None,
            chars: 0,
        };
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({ "phase": "recording", "chars": 0 })
        );
    }
}

/// Frappe réelle dans une zone de texte Win32 créée par le test lui-même :
/// rien n'est jamais tapé ailleurs (si Windows refuse le premier plan,
/// `insert` voit une autre fenêtre et ne tape rien).
#[cfg(all(test, windows))]
mod win_tests {
    use std::ptr::{null, null_mut};
    use std::time::{Duration, Instant};

    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::SetFocus;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, DispatchMessageW, GetWindowTextLengthW, GetWindowTextW,
        PeekMessageW, SetForegroundWindow, TranslateMessage, MSG, PM_REMOVE, WS_OVERLAPPEDWINDOW,
        WS_VISIBLE,
    };

    use super::{foreground, insert, Outcome};

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    /// La zone de texte appartient à ce thread : il doit traiter ses messages.
    fn pump(for_ms: u64) {
        let until = Instant::now() + Duration::from_millis(for_ms);
        // SAFETY : MSG est une structure C sans invariant, remplie par PeekMessageW.
        let mut msg: MSG = unsafe { std::mem::zeroed() };
        while Instant::now() < until {
            // SAFETY : file de messages du thread courant.
            while unsafe { PeekMessageW(&mut msg, null_mut(), 0, 0, PM_REMOVE) } != 0 {
                // SAFETY : message tout juste retiré de la file.
                unsafe {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    fn text_of(hwnd: HWND) -> String {
        // SAFETY : fenêtre vivante créée par ce test ; tampon de la bonne taille.
        unsafe {
            let len = GetWindowTextLengthW(hwnd).max(0) as usize;
            let mut buf = vec![0u16; len + 1];
            let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32).max(0) as usize;
            String::from_utf16_lossy(&buf[..n])
        }
    }

    #[test]
    #[ignore = "prend le focus une seconde : cargo test -- --ignored dictee_win --nocapture"]
    fn dictee_win_tape_dans_une_vraie_zone_de_texte() {
        let class = wide("EDIT");
        let title = wide("");
        // SAFETY : classe système EDIT, sans parent ni paramètre.
        let hwnd = unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                title.as_ptr(),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                100,
                100,
                700,
                120,
                null_mut(),
                null_mut(),
                null_mut(),
                null(),
            )
        };
        assert!(!hwnd.is_null(), "zone de texte non créée");
        // SAFETY : fenêtre créée ci-dessus.
        unsafe {
            SetForegroundWindow(hwnd);
            SetFocus(hwnd);
        }
        pump(300);
        if foreground().0 != hwnd as isize {
            // SAFETY : fenêtre créée ci-dessus.
            unsafe { DestroyWindow(hwnd) };
            eprintln!("dictee_win : Windows a refusé le premier plan, test non concluant");
            return;
        }

        let text = "Café « déjà vu » à 9 h 30 — œuvre n° 2, ça coûte 12 € 👍🏽";
        let started = Instant::now();
        let report = insert(text, foreground());
        let typed_ms = started.elapsed().as_millis();
        pump(400);
        let got = text_of(hwnd);
        // Fenêtre changée entre l'appui et l'insertion : rien n'est tapé.
        let refused = insert("ne doit pas partir", super::Target(hwnd as isize + 4));
        // SAFETY : fenêtre créée ci-dessus.
        unsafe { DestroyWindow(hwnd) };

        eprintln!(
            "dictee_win : {:?}, {} caractères tapés en {typed_ms} ms → {got:?}",
            report.outcome, report.chars
        );
        assert_eq!(report.outcome, Outcome::Inserted);
        assert_eq!(got, text);
        assert_eq!(refused.outcome, Outcome::FocusChanged);
    }
}
