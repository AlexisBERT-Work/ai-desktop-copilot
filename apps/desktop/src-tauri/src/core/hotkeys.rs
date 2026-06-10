use tauri::{App, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tracing::{info, warn};

pub fn register_global_hotkeys(app: &mut App) -> anyhow::Result<()> {
    // Ctrl+Space → toggle overlay
    let toggle_shortcut = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);

    let app_handle = app.handle().clone();
    app.handle()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;

    app.global_shortcut().on_shortcut(toggle_shortcut, move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            info!("Global hotkey triggered: toggle overlay");
            if let Some(window) = _app.get_webview_window("main") {
                let _ = window.emit("ui:overlay-toggle", ());
            }
        }
    })?;

    info!("Global hotkeys registered (Ctrl+Space)");
    Ok(())
}
