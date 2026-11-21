//! Transformer le texte sélectionné — dans n'importe quelle application.
//!
//! Parcours : `Ctrl+Alt+T` → la sélection est copiée (Ctrl+C) → la bulle
//! demande la consigne (« corrige », « traduis en anglais »…) → l'agent
//! transforme, sans outil → avant/après dans la bulle → Entrée colle le
//! résultat à la place de la sélection (Ctrl+V).
//!
//! Garde-fous :
//! - **deux combinaisons seulement** : [`Chord`] ne connaît que Ctrl+C et
//!   Ctrl+V, aucune autre touche ne peut partir d'ici. S'y ajoute, à l'appui
//!   du raccourci, la touche neutre de la dictée qui empêche le relâchement
//!   d'Alt d'ouvrir la barre de menus ;
//! - la fenêtre est **figée à l'appui** et revérifiée avant chaque envoi —
//!   la même, au premier plan, pas plus élevée que CatDesk — par les
//!   contrôles de la dictée (`dictation::check_target`) ; Ctrl, Alt, Maj,
//!   Windows et Entrée doivent être relâchés ;
//! - le **presse-papiers est sauvegardé puis restauré** autour de chaque
//!   envoi, et le texte collé est exclu de l'historique Windows (Win+V) et
//!   du presse-papiers dans le nuage ;
//! - le texte collé est **celui que l'agent a rendu** pour cette sélection,
//!   gardé ici : l'UI peut demander « colle le résultat », jamais « colle
//!   ceci » ; il passe `sandbox::check_paste_text` ;
//! - le texte ne va ni au journal ni à l'audit : seulement des longueurs.
//!
//! La partie pure (décisions, état, conversions) est testée ici ; la partie
//! Win32 est dans [`win`].

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tracing::{info, warn};

use crate::core::audit;
use crate::core::sandbox;
use crate::core::voice::dictation::{self, Target};
use crate::ipc::protocol::EVENT_SELECTION_UPDATE;

/// Miroir de `SELECTION_MAX_CHARS` (shared-types, vérifié par test).
pub const MAX_CHARS: usize = 8_000;
/// Miroir de `SELECTION_MAX_INSTRUCTION_CHARS`.
pub const MAX_INSTRUCTION_CHARS: usize = 300;
/// Au-delà, la sélection en attente est oubliée (le texte ne traîne pas).
const PENDING_TTL: Duration = Duration::from_secs(15 * 60);
/// Temps laissé à l'application pour remplir le presse-papiers après Ctrl+C.
const COPY_TIMEOUT: Duration = Duration::from_millis(1_000);
/// L'application lit le presse-papiers en traitant Ctrl+V, après `SendInput` :
/// on attend avant de remettre l'ancien contenu.
const PASTE_SETTLE: Duration = Duration::from_millis(600);
/// Temps laissé à Windows pour rendre la fenêtre d'origine active.
const FRONT_TIMEOUT: Duration = Duration::from_millis(500);
const POLL: Duration = Duration::from_millis(10);

/// Issue d'une étape — miroir de `SelectionOutcome` (`shared-types/src/selection.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Replaced,
    NoSelection,
    TooLong,
    FocusChanged,
    Elevated,
    KeysHeld,
    Blocked,
    ClipboardBusy,
    Expired,
    AgentError,
}

impl Outcome {
    #[cfg(test)]
    pub const ALL: [Outcome; 10] = [
        Outcome::Replaced,
        Outcome::NoSelection,
        Outcome::TooLong,
        Outcome::FocusChanged,
        Outcome::Elevated,
        Outcome::KeysHeld,
        Outcome::Blocked,
        Outcome::ClipboardBusy,
        Outcome::Expired,
        Outcome::AgentError,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Replaced => "replaced",
            Outcome::NoSelection => "no_selection",
            Outcome::TooLong => "too_long",
            Outcome::FocusChanged => "focus_changed",
            Outcome::Elevated => "elevated",
            Outcome::KeysHeld => "keys_held",
            Outcome::Blocked => "blocked",
            Outcome::ClipboardBusy => "clipboard_busy",
            Outcome::Expired => "expired",
            Outcome::AgentError => "agent_error",
        }
    }
}

/// Refus des contrôles de fenêtre partagés avec la dictée.
fn from_dictation(outcome: dictation::Outcome) -> Outcome {
    match outcome {
        dictation::Outcome::Elevated => Outcome::Elevated,
        _ => Outcome::FocusChanged,
    }
}

/// Charge utile de `selection:update` — miroir de `SelectionEvent`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum SelectionEvent {
    Captured {
        text: String,
    },
    Result {
        text: String,
    },
    Done {
        outcome: Outcome,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
}

/// Les deux seules combinaisons que ce module sait envoyer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Chord {
    Copy,
    Paste,
}

const VK_CONTROL: u16 = 0x11;
const VK_C: u16 = 0x43;
const VK_V: u16 = 0x56;

/// Touches virtuelles d'une combinaison, dans l'ordre : (touche, relâchée ?).
/// Pas de paramètre libre : la liste est fermée par construction.
pub fn chord_sequence(chord: Chord) -> [(u16, bool); 4] {
    let key = match chord {
        Chord::Copy => VK_C,
        Chord::Paste => VK_V,
    };
    [
        (VK_CONTROL, false),
        (key, false),
        (key, true),
        (VK_CONTROL, true),
    ]
}

/// Décision pure après Ctrl+C. `copied` : le presse-papiers a changé.
/// Retours à la ligne ramenés à `\n` (l'agent et la bulle les voient ainsi).
pub fn decide_capture(copied: bool, text: Option<String>) -> Result<String, Outcome> {
    let text = match text {
        Some(t) if copied => t,
        _ => return Err(Outcome::NoSelection),
    };
    let text = text.replace("\r\n", "\n").replace('\0', "");
    if text.trim().is_empty() {
        return Err(Outcome::NoSelection);
    }
    if text.chars().count() > MAX_CHARS {
        return Err(Outcome::TooLong);
    }
    Ok(text)
}

/// Texte prêt pour `CF_UNICODETEXT` : retours à la ligne Windows (`\r\n`),
/// UTF-16, terminé par un zéro.
pub fn clipboard_units(text: &str) -> Vec<u16> {
    let normalized = text.replace("\r\n", "\n").replace('\n', "\r\n");
    normalized.encode_utf16().chain(Some(0)).collect()
}

/// Octets de `CF_UNICODETEXT` → texte, jusqu'au premier zéro.
pub fn utf16_text(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .take_while(|&u| u != 0)
        .collect();
    String::from_utf16_lossy(&units)
}

/// Un format du presse-papiers peut-il être sauvegardé octet par octet ?
/// Non pour les objets GDI et métafichiers (CF_BITMAP, CF_PALETTE…), les
/// formats « dessinés par le propriétaire » et les plages privées : ce ne
/// sont pas des blocs mémoire. L'image reste sauvée par CF_DIB / CF_DIBV5,
/// que Windows synthétise à partir de CF_BITMAP.
pub fn snapshot_format_copyable(format: u32) -> bool {
    !matches!(format, 2 | 3 | 9 | 14 | 0x0080 | 0x0082 | 0x0083 | 0x008E)
        && !(0x0200..=0x03FF).contains(&format)
}

/// Notification `selection.result` de l'agent → (id de la demande, résultat).
pub fn parse_agent_result(params: &Value) -> Option<(String, Result<String, String>)> {
    let id = params.get("requestId")?.as_str()?.to_string();
    let result = if params.get("ok")?.as_bool()? {
        Ok(params.get("text")?.as_str()?.to_string())
    } else {
        Err(params
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Transformation impossible.")
            .to_string())
    };
    Some((id, result))
}

// ─── Sélection en attente ──────────────────────────────────────

enum Stage {
    Captured,
    Transforming(String),
    Result(String),
}

struct Pending {
    target: Target,
    original: String,
    captured: Instant,
    stage: Stage,
}

/// La sélection copiée et ce qui lui arrive — une seule à la fois. État
/// géré par Tauri (`app.manage`).
#[derive(Default)]
pub struct SelectionState {
    inner: Mutex<Option<Pending>>,
}

/// Ce qu'il faut pour coller : la fenêtre d'origine et le résultat.
pub struct PasteJob {
    pub target: Target,
    pub text: String,
    pub original_chars: usize,
}

impl SelectionState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Pending>> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Nouvelle sélection : remplace la précédente, quelle que soit son étape.
    pub fn store(&self, target: Target, original: String, now: Instant) {
        *self.lock() = Some(Pending {
            target,
            original,
            captured: now,
            stage: Stage::Captured,
        });
    }

    /// Sélection en attente et encore fraîche, sinon `Expired` (et oubliée).
    fn fresh(slot: &mut Option<Pending>, now: Instant) -> Result<&mut Pending, Outcome> {
        if slot
            .as_ref()
            .is_some_and(|p| now.duration_since(p.captured) > PENDING_TTL)
        {
            *slot = None;
        }
        slot.as_mut().ok_or(Outcome::Expired)
    }

    /// Démarre une transformation (ou en relance une autre, consigne changée).
    /// Renvoie l'identifiant de la demande et le texte d'origine.
    pub fn begin_transform(&self, now: Instant) -> Result<(String, String), Outcome> {
        let mut slot = self.lock();
        let pending = Self::fresh(&mut slot, now)?;
        let id = uuid::Uuid::new_v4().to_string();
        pending.stage = Stage::Transforming(id.clone());
        Ok((id, pending.original.clone()))
    }

    /// La demande n'a pas pu partir : retour à l'étape « consigne ».
    pub fn transform_failed(&self, request_id: &str) {
        if let Some(p) = self.lock().as_mut() {
            if matches!(&p.stage, Stage::Transforming(id) if id == request_id) {
                p.stage = Stage::Captured;
            }
        }
    }

    /// Résultat de l'agent. `None` si c'est la réponse d'une demande
    /// remplacée ou annulée depuis : elle est ignorée.
    pub fn on_result(
        &self,
        request_id: &str,
        result: Result<String, String>,
    ) -> Option<SelectionEvent> {
        let mut slot = self.lock();
        let pending = slot.as_mut()?;
        if !matches!(&pending.stage, Stage::Transforming(id) if id == request_id) {
            return None;
        }
        let checked = result.and_then(|text| {
            sandbox::check_paste_text(&text)
                .map(|()| text)
                .map_err(|e| e.to_string())
        });
        Some(match checked {
            Ok(text) => {
                pending.stage = Stage::Result(text.clone());
                SelectionEvent::Result { text }
            }
            Err(message) => {
                pending.stage = Stage::Captured;
                SelectionEvent::Done {
                    outcome: Outcome::AgentError,
                    message: Some(message),
                }
            }
        })
    }

    /// Résultat prêt à coller, sans le consommer : un échec (fenêtre fermée,
    /// presse-papiers occupé) laisse réessayer ou copier.
    pub fn paste_job(&self, now: Instant) -> Result<PasteJob, Outcome> {
        let mut slot = self.lock();
        let pending = Self::fresh(&mut slot, now)?;
        match &pending.stage {
            Stage::Result(text) => Ok(PasteJob {
                target: pending.target,
                text: text.clone(),
                original_chars: pending.original.chars().count(),
            }),
            _ => Err(Outcome::Expired),
        }
    }

    /// Oublie la sélection. Renvoie `true` si une transformation était en cours
    /// (l'agent doit alors l'interrompre).
    pub fn clear(&self) -> bool {
        matches!(
            self.lock().take(),
            Some(Pending {
                stage: Stage::Transforming(_),
                ..
            })
        )
    }
}

// ─── Parcours (Win32 derrière) ─────────────────────────────────

/// Attend le relâchement de Ctrl/Alt/Maj/Windows (et d'Entrée, qui valide
/// dans la bulle : tenue, sa répétition partirait dans l'application).
fn wait_keys_released() -> Result<(), Outcome> {
    dictation::wait_modifiers_released().map_err(|_| Outcome::KeysHeld)?;
    let waiting = Instant::now();
    while win::return_down() {
        if waiting.elapsed() >= Duration::from_secs(5) {
            return Err(Outcome::KeysHeld);
        }
        std::thread::sleep(POLL);
    }
    Ok(())
}

fn wait_sequence_change(before: u32, timeout: Duration) -> bool {
    let until = Instant::now() + timeout;
    loop {
        if win::clipboard_sequence() != before {
            return true;
        }
        if Instant::now() >= until {
            return false;
        }
        std::thread::sleep(POLL);
    }
}

/// Copie la sélection de `target` par Ctrl+C, presse-papiers sauvegardé puis
/// restauré. Bloquant (jusqu'à ~6 s) : hors du thread du raccourci.
pub fn capture(target: Target) -> Result<String, Outcome> {
    wait_keys_released()?;
    dictation::check_target(target).map_err(from_dictation)?;
    let saved = win::snapshot()?;
    let before = win::clipboard_sequence();
    if !win::send_chord(Chord::Copy) {
        win::restore(&saved);
        return Err(Outcome::Blocked);
    }
    let copied = wait_sequence_change(before, COPY_TIMEOUT);
    let text = if copied { win::read_text() } else { Ok(None) };
    // Toujours, même en échec : le presse-papiers de l'utilisateur d'abord.
    if !win::restore(&saved) {
        warn!("selection: presse-papiers non restauré après Ctrl+C");
    }
    decide_capture(copied, text?)
}

/// Colle `text` dans `target` par Ctrl+V : rend la fenêtre active, vérifie,
/// pose le texte, envoie Ctrl+V, puis remet l'ancien presse-papiers un peu
/// plus tard (sauf si quelqu'un l'a changé entre-temps).
pub fn paste(target: Target, text: &str) -> Outcome {
    if let Err(e) = sandbox::check_paste_text(text) {
        warn!("selection: {e}");
        return Outcome::AgentError;
    }
    if let Err(outcome) = wait_keys_released() {
        return outcome;
    }
    if !win::bring_to_front(target) {
        return Outcome::FocusChanged;
    }
    if let Err(outcome) = dictation::check_target(target) {
        return from_dictation(outcome);
    }
    let saved = match win::snapshot() {
        Ok(saved) => saved,
        Err(outcome) => return outcome,
    };
    let ours = match win::write_text(text) {
        Ok(seq) => seq,
        Err(outcome) => {
            win::restore(&saved);
            return outcome;
        }
    };
    let sent = win::send_chord(Chord::Paste);
    std::thread::spawn(move || {
        std::thread::sleep(if sent { PASTE_SETTLE } else { Duration::ZERO });
        if win::clipboard_sequence() == ours && !win::restore(&saved) {
            warn!("selection: presse-papiers non restauré après Ctrl+V");
        }
    });
    if sent {
        Outcome::Replaced
    } else {
        Outcome::Blocked
    }
}

static CAPTURING: AtomicBool = AtomicBool::new(false);

/// Publie un événement à la bulle (fenêtre `main`).
pub fn emit(app: &AppHandle, event: &SelectionEvent) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.emit(EVENT_SELECTION_UPDATE, event) {
            warn!("selection: événement non publié ({e})");
        }
    }
}

/// Raccourci pressé, fenêtre figée : copie la sélection hors du thread du
/// raccourci, la garde, et ouvre la bulle (ou dit pourquoi rien n'est copié).
pub fn on_hotkey(app: &AppHandle, target: Target) {
    if CAPTURING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let result = capture(target);
        CAPTURING.store(false, Ordering::SeqCst);
        let event = match result {
            Ok(text) => {
                let chars = text.chars().count();
                if let Some(state) = app.try_state::<SelectionState>() {
                    state.store(target, text.clone(), Instant::now());
                }
                // Ctrl+C envoyé à une autre application : une trace, sans le texte.
                audit::log("SELECTION_CAPTURE", json!({ "chars": chars }));
                SelectionEvent::Captured { text }
            }
            Err(outcome) => {
                info!(outcome = outcome.as_str(), "selection: rien de copié");
                SelectionEvent::Done {
                    outcome,
                    message: None,
                }
            }
        };
        emit(&app, &event);
    });
}

/// Notification `selection.result` de l'agent (relayée par le bridge).
pub fn on_agent_result(app: &AppHandle, params: &Value) {
    let Some((request_id, result)) = parse_agent_result(params) else {
        warn!("selection.result mal formée");
        return;
    };
    let Some(state) = app.try_state::<SelectionState>() else {
        return;
    };
    if let Some(event) = state.on_result(&request_id, result) {
        emit(app, &event);
    }
}

#[cfg(windows)]
mod win {
    use std::mem::size_of;
    use std::ptr::null_mut;
    use std::time::Instant;

    use windows_sys::Win32::Foundation::{GlobalFree, HANDLE, HWND};
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData,
        GetClipboardSequenceNumber, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        VK_RETURN,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};

    use super::{
        chord_sequence, clipboard_units, snapshot_format_copyable, utf16_text, Chord, Outcome,
        Target, FRONT_TIMEOUT, POLL, VK_CONTROL,
    };

    const CF_UNICODETEXT: u32 = 13;
    /// Au-delà (une grosse image copiée), on ne sauve pas le reste.
    const MAX_SNAPSHOT_BYTES: usize = 64 * 1024 * 1024;
    const OPEN_ATTEMPTS: u32 = 30;

    /// Contenu du presse-papiers, format par format.
    pub struct Snapshot(Vec<(u32, Vec<u8>)>);

    /// Presse-papiers ouvert ; fermé à la sortie de portée, quoi qu'il arrive.
    struct Open;

    impl Open {
        /// Une autre application peut le tenir un instant : on réessaie.
        fn new() -> Result<Open, Outcome> {
            for _ in 0..OPEN_ATTEMPTS {
                // SAFETY : pas de fenêtre propriétaire, accès lié au thread.
                if unsafe { OpenClipboard(null_mut()) } != 0 {
                    return Ok(Open);
                }
                std::thread::sleep(std::time::Duration::from_millis(15));
            }
            Err(Outcome::ClipboardBusy)
        }
    }

    impl Drop for Open {
        fn drop(&mut self) {
            // SAFETY : ouvert par `Open::new` sur ce thread.
            unsafe { CloseClipboard() };
        }
    }

    /// Copie d'un bloc mémoire global (presse-papiers ouvert).
    ///
    /// # Safety
    /// `handle` vient de `GetClipboardData`, presse-papiers ouvert.
    unsafe fn global_bytes(handle: HANDLE) -> Option<Vec<u8>> {
        let size = GlobalSize(handle);
        if size == 0 {
            return None;
        }
        let ptr = GlobalLock(handle) as *const u8;
        if ptr.is_null() {
            return None;
        }
        let bytes = std::slice::from_raw_parts(ptr, size).to_vec();
        GlobalUnlock(handle);
        Some(bytes)
    }

    /// Pose un format. Le système devient propriétaire du bloc s'il réussit.
    ///
    /// # Safety
    /// Presse-papiers ouvert par ce thread et vidé par `EmptyClipboard`.
    unsafe fn set_bytes(format: u32, bytes: &[u8]) -> bool {
        let handle = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1));
        if handle.is_null() {
            return false;
        }
        let ptr = GlobalLock(handle) as *mut u8;
        if ptr.is_null() {
            GlobalFree(handle);
            return false;
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        GlobalUnlock(handle);
        if SetClipboardData(format, handle).is_null() {
            GlobalFree(handle);
            return false;
        }
        true
    }

    pub fn snapshot() -> Result<Snapshot, Outcome> {
        let _open = Open::new()?;
        let mut formats = Vec::new();
        let mut total = 0usize;
        let mut format = 0u32;
        loop {
            // SAFETY : presse-papiers ouvert ; 0 = fin de l'énumération.
            format = unsafe { EnumClipboardFormats(format) };
            if format == 0 {
                break;
            }
            if !snapshot_format_copyable(format) {
                continue;
            }
            // SAFETY : presse-papiers ouvert, format énuméré à l'instant.
            let handle = unsafe { GetClipboardData(format) };
            if handle.is_null() {
                continue;
            }
            // SAFETY : handle rendu par GetClipboardData ci-dessus.
            let Some(bytes) = (unsafe { global_bytes(handle) }) else {
                continue;
            };
            total += bytes.len();
            if total > MAX_SNAPSHOT_BYTES {
                break;
            }
            formats.push((format, bytes));
        }
        Ok(Snapshot(formats))
    }

    pub fn restore(snapshot: &Snapshot) -> bool {
        let Ok(_open) = Open::new() else {
            return false;
        };
        // SAFETY : presse-papiers ouvert par ce thread.
        unsafe { EmptyClipboard() };
        let mut ok = true;
        for (format, bytes) in &snapshot.0 {
            // SAFETY : ouvert et vidé ci-dessus.
            ok &= unsafe { set_bytes(*format, bytes) };
        }
        ok
    }

    pub fn read_text() -> Result<Option<String>, Outcome> {
        let _open = Open::new()?;
        // SAFETY : presse-papiers ouvert.
        let handle = unsafe { GetClipboardData(CF_UNICODETEXT) };
        if handle.is_null() {
            return Ok(None);
        }
        // SAFETY : handle rendu par GetClipboardData ci-dessus.
        Ok(unsafe { global_bytes(handle) }.map(|bytes| utf16_text(&bytes)))
    }

    /// Pose `text`, hors de l'historique Win+V et du nuage. Renvoie le numéro
    /// de séquence obtenu, pour savoir plus tard si quelqu'un l'a changé.
    pub fn write_text(text: &str) -> Result<u32, Outcome> {
        let bytes: Vec<u8> = clipboard_units(text)
            .iter()
            .flat_map(|u| u.to_le_bytes())
            .collect();
        {
            let _open = Open::new()?;
            // SAFETY : presse-papiers ouvert par ce thread.
            unsafe { EmptyClipboard() };
            // SAFETY : ouvert et vidé ci-dessus.
            if !unsafe { set_bytes(CF_UNICODETEXT, &bytes) } {
                return Err(Outcome::ClipboardBusy);
            }
            let zero = 0u32.to_le_bytes();
            for name in [
                "ExcludeClipboardContentFromMonitorProcessing",
                "CanIncludeInClipboardHistory",
                "CanUploadToCloudClipboard",
            ] {
                let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
                // SAFETY : chaîne UTF-16 terminée par zéro, vivante pendant l'appel.
                let format = unsafe { RegisterClipboardFormatW(wide.as_ptr()) };
                if format != 0 {
                    // SAFETY : presse-papiers toujours ouvert.
                    unsafe { set_bytes(format, &zero) };
                }
            }
        }
        Ok(clipboard_sequence())
    }

    pub fn clipboard_sequence() -> u32 {
        // SAFETY : aucun argument.
        unsafe { GetClipboardSequenceNumber() }
    }

    fn key(vk: u16, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    /// Envoie Ctrl+C ou Ctrl+V, en un seul `SendInput` (atomique). Si Windows
    /// n'en prend qu'une partie, Ctrl est relâché pour ne pas rester enfoncé.
    pub fn send_chord(chord: Chord) -> bool {
        let inputs: Vec<INPUT> = chord_sequence(chord)
            .iter()
            .map(|&(vk, up)| key(vk, up))
            .collect();
        // SAFETY : tableau valide de `inputs.len()` INPUT initialisés.
        let sent = unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                size_of::<INPUT>() as i32,
            )
        } as usize;
        if sent > 0 && sent < inputs.len() {
            let release = [key(VK_CONTROL, true)];
            // SAFETY : idem, un seul INPUT.
            unsafe { SendInput(1, release.as_ptr(), size_of::<INPUT>() as i32) };
        }
        sent == inputs.len()
    }

    pub fn return_down() -> bool {
        // SAFETY : lecture d'état clavier, sans pointeur.
        unsafe { GetAsyncKeyState(i32::from(VK_RETURN)) as u16 & 0x8000 != 0 }
    }

    fn foreground() -> Target {
        // SAFETY : aucun argument.
        Target(unsafe { GetForegroundWindow() } as isize)
    }

    /// Rend `target` active. Permis à CatDesk quand sa bulle a le focus (la
    /// validation vient d'y être faite) ; vérifié, jamais supposé.
    pub fn bring_to_front(target: Target) -> bool {
        if target.0 == 0 {
            return false;
        }
        if foreground() == target {
            return true;
        }
        // SAFETY : une poignée périmée fait simplement échouer l'appel.
        unsafe { SetForegroundWindow(target.0 as HWND) };
        let until = Instant::now() + FRONT_TIMEOUT;
        while Instant::now() < until {
            if foreground() == target {
                return true;
            }
            std::thread::sleep(POLL);
        }
        false
    }
}

/// Hors Windows, rien n'est copié ni collé : CatDesk ne vise que Windows,
/// ceci garde juste la compilation possible ailleurs.
#[cfg(not(windows))]
mod win {
    use super::{Chord, Outcome, Target};

    pub struct Snapshot;

    pub fn snapshot() -> Result<Snapshot, Outcome> {
        Err(Outcome::ClipboardBusy)
    }
    pub fn restore(_snapshot: &Snapshot) -> bool {
        false
    }
    pub fn read_text() -> Result<Option<String>, Outcome> {
        Ok(None)
    }
    pub fn write_text(_text: &str) -> Result<u32, Outcome> {
        Err(Outcome::ClipboardBusy)
    }
    pub fn clipboard_sequence() -> u32 {
        0
    }
    pub fn send_chord(_chord: Chord) -> bool {
        false
    }
    pub fn return_down() -> bool {
        false
    }
    pub fn bring_to_front(_target: Target) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: Target = Target(0x1234);

    #[test]
    fn seules_ctrl_c_et_ctrl_v_existent() {
        assert_eq!(
            chord_sequence(Chord::Copy),
            [(0x11, false), (0x43, false), (0x43, true), (0x11, true)]
        );
        assert_eq!(
            chord_sequence(Chord::Paste),
            [(0x11, false), (0x56, false), (0x56, true), (0x11, true)]
        );
    }

    #[test]
    fn la_copie_doit_avoir_change_le_presse_papiers() {
        // Rien de sélectionné : l'application ne copie rien, l'ancien
        // contenu ne doit pas passer pour la sélection.
        assert_eq!(
            decide_capture(false, Some("ancien contenu".into())),
            Err(Outcome::NoSelection)
        );
        assert_eq!(decide_capture(true, None), Err(Outcome::NoSelection));
        assert_eq!(
            decide_capture(true, Some(" \r\n ".into())),
            Err(Outcome::NoSelection)
        );
        assert_eq!(
            decide_capture(true, Some("Ligne 1\r\nLigne 2\0".into())),
            Ok("Ligne 1\nLigne 2".into())
        );
    }

    #[test]
    fn une_selection_trop_longue_est_refusee() {
        let at_limit = "é".repeat(MAX_CHARS);
        assert_eq!(decide_capture(true, Some(at_limit.clone())), Ok(at_limit));
        assert_eq!(
            decide_capture(true, Some("a".repeat(MAX_CHARS + 1))),
            Err(Outcome::TooLong)
        );
    }

    #[test]
    fn le_texte_colle_a_des_retours_windows_et_un_zero_final() {
        let units = clipboard_units("a\nb\r\nc");
        assert_eq!(String::from_utf16(&units).unwrap(), "a\r\nb\r\nc\0");
        let bytes: Vec<u8> = clipboard_units("Où ? 👍")
            .iter()
            .flat_map(|u| u.to_le_bytes())
            .collect();
        assert_eq!(utf16_text(&bytes), "Où ? 👍");
        // Octet impair et zéro au milieu : on s'arrête proprement.
        assert_eq!(utf16_text(&[0x41, 0, 0, 0, 0x42, 0, 7]), "A");
    }

    #[test]
    fn les_objets_gdi_ne_sont_pas_sauves_octet_par_octet() {
        for format in [1, 7, 8, 13, 15, 16, 17, 0xC000, 0xC123] {
            assert!(snapshot_format_copyable(format), "{format}");
        }
        for format in [
            2, 3, 9, 14, 0x80, 0x82, 0x83, 0x8E, 0x200, 0x2FF, 0x300, 0x3FF,
        ] {
            assert!(!snapshot_format_copyable(format), "{format}");
        }
    }

    #[test]
    fn parcours_complet_de_la_selection_en_attente() {
        let state = SelectionState::default();
        let t0 = Instant::now();
        assert_eq!(state.begin_transform(t0).err(), Some(Outcome::Expired));

        state.store(W, "Je suis la.".into(), t0);
        let (id, text) = state.begin_transform(t0).unwrap();
        assert_eq!(text, "Je suis la.");
        // Rien à coller tant que l'agent n'a pas répondu.
        assert_eq!(state.paste_job(t0).err(), Some(Outcome::Expired));

        assert_eq!(
            state.on_result(&id, Ok("Je suis là.".into())),
            Some(SelectionEvent::Result {
                text: "Je suis là.".into()
            })
        );
        let job = state.paste_job(t0).unwrap();
        assert_eq!(job.target, W);
        assert_eq!(job.text, "Je suis là.");
        assert_eq!(job.original_chars, 11);
        // Non consommé : un échec de collage laisse réessayer.
        assert!(state.paste_job(t0).is_ok());
        assert!(!state.clear());
        assert_eq!(state.paste_job(t0).err(), Some(Outcome::Expired));
    }

    #[test]
    fn la_reponse_d_une_demande_remplacee_est_ignoree() {
        let state = SelectionState::default();
        let t0 = Instant::now();
        state.store(W, "texte".into(), t0);
        let (old, _) = state.begin_transform(t0).unwrap();
        let (new, _) = state.begin_transform(t0).unwrap();
        assert_ne!(old, new);
        assert_eq!(state.on_result(&old, Ok("vieux".into())), None);
        assert!(state.on_result(&new, Ok("neuf".into())).is_some());
        assert_eq!(state.paste_job(t0).unwrap().text, "neuf");
        // Une nouvelle sélection efface tout ce qui précède.
        state.store(W, "autre".into(), t0);
        assert_eq!(state.on_result(&new, Ok("neuf".into())), None);
        assert_eq!(state.paste_job(t0).err(), Some(Outcome::Expired));
    }

    #[test]
    fn un_echec_de_l_agent_ramene_a_la_consigne() {
        let state = SelectionState::default();
        let t0 = Instant::now();
        state.store(W, "texte".into(), t0);
        let (id, _) = state.begin_transform(t0).unwrap();
        assert_eq!(
            state.on_result(&id, Err("Ollama injoignable".into())),
            Some(SelectionEvent::Done {
                outcome: Outcome::AgentError,
                message: Some("Ollama injoignable".into())
            })
        );
        assert!(state.begin_transform(t0).is_ok());
        // Une demande qui n'a pas pu partir aussi.
        let (id, _) = state.begin_transform(t0).unwrap();
        state.transform_failed(&id);
        assert!(!state.clear());
    }

    #[test]
    fn un_resultat_impossible_a_coller_est_refuse() {
        let state = SelectionState::default();
        let t0 = Instant::now();
        state.store(W, "texte".into(), t0);
        let (id, _) = state.begin_transform(t0).unwrap();
        let event = state.on_result(&id, Ok("a\0b".into())).unwrap();
        assert!(matches!(
            event,
            SelectionEvent::Done {
                outcome: Outcome::AgentError,
                ..
            }
        ));
        assert_eq!(state.paste_job(t0).err(), Some(Outcome::Expired));
    }

    #[test]
    fn la_selection_est_oubliee_apres_quinze_minutes() {
        let state = SelectionState::default();
        let t0 = Instant::now();
        state.store(W, "texte".into(), t0);
        let later = t0 + PENDING_TTL + Duration::from_secs(1);
        assert_eq!(state.begin_transform(later).err(), Some(Outcome::Expired));
        // Et vraiment oubliée, pas seulement refusée.
        assert_eq!(state.begin_transform(t0).err(), Some(Outcome::Expired));
    }

    #[test]
    fn annuler_pendant_la_transformation_previent_l_agent() {
        let state = SelectionState::default();
        let t0 = Instant::now();
        state.store(W, "texte".into(), t0);
        state.begin_transform(t0).unwrap();
        assert!(state.clear());
        assert!(!state.clear());
    }

    #[test]
    fn notification_de_l_agent() {
        assert_eq!(
            parse_agent_result(&json!({ "requestId": "r", "ok": true, "text": "t" })),
            Some(("r".into(), Ok("t".into())))
        );
        assert_eq!(
            parse_agent_result(&json!({ "requestId": "r", "ok": false, "error": "e" })),
            Some(("r".into(), Err("e".into())))
        );
        assert_eq!(
            parse_agent_result(&json!({ "ok": true, "text": "t" })),
            None
        );
        assert_eq!(
            parse_agent_result(&json!({ "requestId": "r", "ok": true })),
            None
        );
    }

    #[test]
    fn miroir_typescript() {
        let ts = include_str!("../../../../../packages/shared-types/src/selection.ts");
        for outcome in Outcome::ALL {
            let json = serde_json::to_string(&outcome).unwrap();
            assert_eq!(json, format!("\"{}\"", outcome.as_str()));
            assert!(
                ts.contains(&format!("'{}'", outcome.as_str())),
                "issue absente de SelectionOutcome : {}",
                outcome.as_str()
            );
        }
        assert!(ts.contains(&format!(
            "SELECTION_MAX_CHARS = {}_{:03};",
            MAX_CHARS / 1000,
            MAX_CHARS % 1000
        )));
        assert!(ts.contains(&format!(
            "SELECTION_MAX_INSTRUCTION_CHARS = {MAX_INSTRUCTION_CHARS};"
        )));
        assert_eq!(
            serde_json::to_value(SelectionEvent::Captured { text: "t".into() }).unwrap(),
            json!({ "phase": "captured", "text": "t" })
        );
        assert_eq!(
            serde_json::to_value(SelectionEvent::Done {
                outcome: Outcome::NoSelection,
                message: None
            })
            .unwrap(),
            json!({ "phase": "done", "outcome": "no_selection" })
        );
        for phase in ["'captured'", "'result'", "'done'"] {
            assert!(
                ts.contains(phase),
                "phase absente de SelectionEvent : {phase}"
            );
        }
    }
}

/// Copie et collage réels dans une zone de texte Win32 créée par le test :
/// rien n'est jamais envoyé ailleurs (si Windows refuse le premier plan, les
/// contrôles voient une autre fenêtre et n'envoient rien). Touche au vrai
/// presse-papiers — d'où `#[ignore]` — et vérifie qu'il est restauré.
#[cfg(all(test, windows))]
mod win_tests {
    use std::ptr::{null, null_mut};
    use std::time::{Duration, Instant};

    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::SetFocus;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, DispatchMessageW, GetWindowTextLengthW, GetWindowTextW,
        PeekMessageW, SendMessageW, SetForegroundWindow, SetWindowTextW, TranslateMessage, MSG,
        PM_REMOVE, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
    };

    use super::{capture, paste, win, Outcome};
    use crate::core::voice::dictation::{foreground, Target};

    const EM_SETSEL: u32 = 0x00B1;
    const ES_MULTILINE: u32 = 0x0004;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    /// Traite les messages de la zone de texte (elle appartient à ce thread)
    /// jusqu'à la fin de `job`, lancé sur un autre thread.
    fn pump_until<T: Send + 'static>(job: impl FnOnce() -> T + Send + 'static) -> T {
        let handle = std::thread::spawn(job);
        // SAFETY : MSG est une structure C sans invariant, remplie par PeekMessageW.
        let mut msg: MSG = unsafe { std::mem::zeroed() };
        while !handle.is_finished() {
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
        handle.join().expect("thread du test")
    }

    fn pump(for_ms: u64) {
        let until = Instant::now() + Duration::from_millis(for_ms);
        pump_until(move || {
            while Instant::now() < until {
                std::thread::sleep(Duration::from_millis(5));
            }
        });
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
    #[ignore = "prend le focus et le presse-papiers une seconde : cargo test -- --ignored selection_win --nocapture"]
    fn selection_win_copie_puis_remplace_dans_une_vraie_zone_de_texte() {
        // Le vrai presse-papiers, remis à la fin ; à sa place, un contenu
        // connu qui doit revenir intact après chaque envoi.
        if win::clipboard_sequence() == 0 {
            // Numéro de séquence nul = pas d'accès au presse-papiers de la
            // session (processus lancé dans un bac à sable, un service…).
            eprintln!("selection_win : presse-papiers inaccessible depuis ce processus, test non concluant");
            return;
        }
        let real = win::snapshot().expect("presse-papiers");
        win::write_text("presse-papiers de l'utilisateur").expect("presse-papiers");

        let class = wide("EDIT");
        let title = wide("");
        // SAFETY : classe système EDIT, sans parent ni paramètre.
        let hwnd = unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                title.as_ptr(),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE | ES_MULTILINE,
                100,
                100,
                700,
                160,
                null_mut(),
                null_mut(),
                null_mut(),
                null(),
            )
        };
        assert!(!hwnd.is_null(), "zone de texte non créée");
        let original = "Je suis la.\r\nÇa marche « bien » 👍";
        let content = wide(original);
        // SAFETY : fenêtre créée ci-dessus ; texte terminé par zéro.
        unsafe {
            SetWindowTextW(hwnd, content.as_ptr());
            SetForegroundWindow(hwnd);
            SetFocus(hwnd);
            SendMessageW(hwnd, EM_SETSEL, 0, -1);
        }
        pump(300);
        if foreground().0 != hwnd as isize {
            // SAFETY : fenêtre créée ci-dessus.
            unsafe { DestroyWindow(hwnd) };
            win::restore(&real);
            eprintln!("selection_win : Windows a refusé le premier plan, test non concluant");
            return;
        }
        let target = Target(hwnd as isize);

        let started = Instant::now();
        let copied = pump_until(move || capture(target));
        let copy_ms = started.elapsed().as_millis();
        let after_copy = pump_until(win::read_text);

        let started = Instant::now();
        let replaced = pump_until(move || paste(target, "Je suis là.\nÇa marche « bien » 👍"));
        pump(900);
        let paste_ms = started.elapsed().as_millis();
        let got = text_of(hwnd);
        let after_paste = pump_until(win::read_text);
        // Fenêtre qui n'existe plus : rien n'est collé.
        // SAFETY : fenêtre créée ci-dessus.
        unsafe { DestroyWindow(hwnd) };
        let refused = pump_until(move || paste(target, "ne doit pas partir"));
        std::thread::sleep(Duration::from_millis(100));
        win::restore(&real);

        eprintln!(
            "selection_win : copie {copied:?} en {copy_ms} ms, collage {replaced:?} \
             (+ restauration) en {paste_ms} ms → {got:?}"
        );
        assert_eq!(copied, Ok("Je suis la.\nÇa marche « bien » 👍".to_string()));
        assert_eq!(
            after_copy,
            Ok(Some("presse-papiers de l'utilisateur".into()))
        );
        assert_eq!(replaced, Outcome::Replaced);
        assert_eq!(got, "Je suis là.\r\nÇa marche « bien » 👍");
        assert_eq!(
            after_paste,
            Ok(Some("presse-papiers de l'utilisateur".into()))
        );
        assert_eq!(refused, Outcome::FocusChanged);
    }
}
