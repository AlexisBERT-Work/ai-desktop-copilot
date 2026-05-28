mod commands;
mod core;
mod ipc;

use tauri::Manager;
use tracing::info;

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "neurodesk=info".to_string()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
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
        ])
        .setup(|app| {
            info!("NeuroDesk starting up");

            // Start Node.js agent sidecar
            ipc::bridge::start_agent_sidecar(app.handle().clone())?;

            // Register global hotkey: Ctrl+Space → toggle overlay
            core::hotkeys::register_global_hotkeys(app)?;

            // Setup system tray
            core::tray::setup_tray(app)?;

            // Configure window: always-on-top, frameless, transparent
            let window = app.get_webview_window("main").unwrap();
            window.set_always_on_top(true)?;

            info!("NeuroDesk ready");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running NeuroDesk");
}
