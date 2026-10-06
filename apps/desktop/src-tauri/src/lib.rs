mod commands;
mod core;
mod ipc;

use tauri::{Emitter, Manager, RunEvent};
use tracing::info;

/// Arrête ce que CatDesk a lancé : l'agent (par fin de stdin, pour qu'il
/// s'arrête proprement) et l'Ollama embarqué. Appelé à la fermeture de l'app
/// et avant l'installation d'une mise à jour — Windows ne tue pas les enfants
/// avec leur parent.
pub(crate) fn stop_children() {
    tauri::async_runtime::block_on(ipc::bridge::shutdown());
    core::ollama::shutdown();
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "catdesk=info".to_string()))
        .init();

    let builder = tauri::Builder::default()
        // Must be the first plugin: ensures only one CatDesk runs. A second
        // launch (e.g. autostart firing while it's already open) hands off to the
        // running instance — which reveals its bubble — then exits, instead of
        // spawning a duplicate that can't grab the Ctrl+Space hotkey.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            info!("Second instance launched; revealing existing window");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit(ipc::protocol::EVENT_UI_OVERLAY_TOGGLE, ());
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());

    // The updater plugin requires a `plugins.updater` config block, which only
    // exists in the release config (tauri.release.conf.json). Registering it in
    // a dev build (plain tauri.conf.json) panics at startup, and a dev build
    // should never self-update anyway — so it is release-only.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .invoke_handler(tauri::generate_handler![
            commands::chat::chat_send,
            commands::chat::chat_cancel,
            commands::chat::set_market_watchlist,
            commands::press::run_press_digest,
            commands::press::save_local_press_feed,
            commands::press::delete_local_press_feed,
            commands::press::run_local_press_now,
            commands::press::sync_local_press,
            commands::models::get_ollama_models_info,
            commands::models::get_gpu_vram_bytes,
            commands::permissions::permission_respond,
            commands::settings::update_settings,
            commands::tuning::get_kv_cache_status,
            commands::tuning::set_kv_cache_type,
            commands::tuning::get_recommended_model,
            commands::voice::voice_status,
            commands::voice::voice_listen_start,
            commands::voice::voice_listen_stop,
            commands::voice::voice_speak,
            commands::voice::voice_speak_end,
            commands::voice::voice_stop_speaking,
            commands::voice::voice_configure,
            commands::voice::voice_warmup,
        ])
        .setup(|app| {
            info!("CatDesk starting up");

            // Threads voix (écoute / parole). Aucun modèle n'est chargé ici :
            // l'UI appelle `voice_warmup` quand la voix est activée.
            app.manage(core::voice::spawn(app.handle().clone()));

            // Start the embedded Ollama server first (no-op in dev, where the
            // developer runs their own). The agent connects to it lazily, so a
            // brief startup race is fine.
            core::ollama::ensure_ollama_running(app.handle());

            // First-run GPU auto-tune: once the managed Ollama is up, pick the
            // KV-cache type that fits this machine's VRAM and apply it silently.
            // No-op after the first decision, or with an external Ollama.
            commands::tuning::spawn_auto_tune(app.handle().clone());

            // Start Node.js agent sidecar
            ipc::bridge::start_agent_sidecar(app.handle().clone())?;

            // Check GitHub Releases for a newer signed build and self-update
            // silently. Release-only (needs plugins.updater config); a dev build
            // must not self-update.
            #[cfg(not(debug_assertions))]
            core::updater::spawn_update_check(app.handle().clone());

            // Register global hotkey: Ctrl+Space → toggle overlay
            core::hotkeys::register_global_hotkeys(app)?;

            // Setup system tray
            core::tray::setup_tray(app)?;

            // Configure window: always-on-top, frameless, transparent
            if let Some(window) = app.get_webview_window("main") {
                window.set_always_on_top(true)?;
            }

            info!("CatDesk ready");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building CatDesk")
        .run(|_app, event| {
            if let RunEvent::Exit = event {
                info!("CatDesk exiting — stopping child processes");
                stop_children();
            }
        });
}
