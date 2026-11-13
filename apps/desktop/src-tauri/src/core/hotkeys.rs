use std::time::Instant;

use tauri::{App, AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tracing::{info, warn};

use crate::core::error::CatdeskError;
use crate::core::voice::{dictation, ListenerCommand, VoiceHandle};
use crate::ipc::protocol::EVENT_UI_OVERLAY_TOGGLE;

pub fn register_global_hotkeys(app: &mut App) -> anyhow::Result<()> {
    // Toggle the overlay. Ctrl+Space is the primary hotkey, but Windows can
    // swallow it (it toggles the IME when one is installed) or another app may
    // already own it — so we also register Ctrl+Shift+Space as a reliable
    // fallback. Each is registered independently so one failing never blocks the
    // other. The global-shortcut plugin itself is registered once in `lib.rs`.
    let shortcuts = [
        Shortcut::new(Some(Modifiers::CONTROL), Code::Space),
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space),
    ];

    let global_shortcut = app.global_shortcut();
    for shortcut in shortcuts {
        match global_shortcut.on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                info!("Global hotkey triggered: toggle overlay");
                if let Some(window) = app.get_webview_window("main") {
                    // Constante, pas un littéral : le test de contrat
                    // protocol.rs ne voit pas les chaînes en dur, un renommage
                    // côté TypeScript passerait donc inaperçu ici.
                    let _ = window.emit(EVENT_UI_OVERLAY_TOGGLE, ());
                }
            }
        }) {
            Ok(()) => info!("Registered global hotkey: {shortcut:?}"),
            Err(e) => warn!("Could not register global hotkey {shortcut:?}: {e}"),
        }
    }

    Ok(())
}

/// Dictée : `Ctrl+Alt+Espace` **maintenu**. Sur AZERTY, AltGr vaut Ctrl+Alt :
/// AltGr+Espace déclenche donc aussi la dictée (aucun caractère n'y est
/// attaché d'habitude).
fn dictation_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space)
}

/// Enregistre ou retire le raccourci de dictée. Désactivée par défaut : le
/// raccourci n'existe que si l'utilisateur l'a demandé (un micro qui s'ouvre
/// sur une touche globale ne doit pas surprendre).
///
/// global-hotkey émet `Released` au relâchement d'Espace (sondage toutes les
/// 50 ms) ; Ctrl et Alt peuvent être encore tenus, l'insertion les attend.
///
/// Renvoie `true` si l'état a changé (rien à faire sinon).
pub fn set_dictation_hotkey(app: &AppHandle, enabled: bool) -> Result<bool, CatdeskError> {
    let global_shortcut = app.global_shortcut();
    let shortcut = dictation_shortcut();
    if global_shortcut.is_registered(shortcut) == enabled {
        return Ok(false);
    }
    if !enabled {
        global_shortcut.unregister(shortcut).map_err(|e| {
            CatdeskError::Refused(format!("Raccourci de dictée impossible à retirer ({e})"))
        })?;
        info!("Dictation hotkey unregistered");
        return Ok(true);
    }
    global_shortcut
        .on_shortcut(shortcut, |app, _shortcut, event| {
            let Some(voice) = app.try_state::<VoiceHandle>() else {
                return;
            };
            let command = match event.state {
                ShortcutState::Pressed => {
                    // Figée avant toute chose : c'est là que le texte ira.
                    let target = dictation::foreground();
                    dictation::send_menu_mask();
                    // La voix de CatDesk finirait dans le texte dicté.
                    voice.stop_speaking();
                    ListenerCommand::DictateStart(target)
                }
                ShortcutState::Released => ListenerCommand::DictateEnd(Instant::now()),
            };
            if voice.listener.send(command).is_err() {
                warn!("Dictation: listener thread stopped");
            }
        })
        .map_err(|e| {
            CatdeskError::Refused(format!(
                "Raccourci Ctrl+Alt+Espace indisponible, sans doute pris par une autre application ({e})"
            ))
        })?;
    info!("Dictation hotkey registered: {shortcut:?}");
    Ok(true)
}
