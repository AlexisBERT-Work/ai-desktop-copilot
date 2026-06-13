mod commands;
mod core;
mod ipc;

use tauri::{Emitter, Manager};
use tracing::info;

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "catdesk=info".to_string()),
        )
        .init();

    tauri::Builder::default()
        // Must be the first plugin: ensures only one CatDesk runs. A second
        // launch (e.g. autostart firing while it's already open) hands off to the
        // running instance — which reveals its bubble — then exits, instead of
        // spawning a duplicate that can't grab the Ctrl+Space hotkey.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            info!("Second instance launched; revealing existing window");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("ui:overlay-toggle", ());
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::chat::chat_send,
            commands::chat::get_ollama_models,
            commands::screen::screen_capture,
            commands::screen::screen_capture_active_window,
            commands::filesystem::file_read,
            commands::filesystem::file_write,
            commands::filesystem::dir_list,
            commands::system::system_run_command,
            commands::system::open_application,
            commands::clipboard::clipboard_read,
            commands::clipboard::clipboard_write,
            commands::permissions::permission_respond,
            commands::settings::update_settings,
        ])
        .setup(|app| {
            info!("CatDesk starting up");

            // Start the embedded Ollama server first (no-op in dev, where the
            // developer runs their own). The agent connects to it lazily, so a
            // brief startup race is fine.
            core::ollama::ensure_ollama_running(app.handle());

            // Start Node.js agent sidecar
            ipc::bridge::start_agent_sidecar(app.handle().clone())?;

            // Check GitHub Releases for a newer signed build and self-update
            // silently. No-op in dev / offline.
            core::updater::spawn_update_check(app.handle().clone());

            // Register global hotkey: Ctrl+Space → toggle overlay
            core::hotkeys::register_global_hotkeys(app)?;

            // Setup system tray
            core::tray::setup_tray(app)?;

            // Configure window: always-on-top, frameless, transparent
            let window = app.get_webview_window("main").unwrap();
            window.set_always_on_top(true)?;

            info!("CatDesk ready");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running CatDesk");
}
