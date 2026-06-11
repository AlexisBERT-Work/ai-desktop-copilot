use tauri::{App, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tracing::{info, warn};

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
                    let _ = window.emit("ui:overlay-toggle", ());
                }
            }
        }) {
            Ok(()) => info!("Registered global hotkey: {shortcut:?}"),
            Err(e) => warn!("Could not register global hotkey {shortcut:?}: {e}"),
        }
    }

    Ok(())
}
