//! Silent auto-update against GitHub Releases.
//!
//! On startup we ask the Tauri updater plugin whether a newer signed build is
//! published at the configured endpoint (a `latest.json` on GitHub Releases).
//! If so we download + install it (NSIS, silent) and relaunch. Update artifacts
//! ship only the app code — never the multi-GB model — so this download is
//! small (see core::ollama for why the model is kept out of the bundle).
//!
//! Failures (offline, no update, missing config in dev) are swallowed: the app
//! must always start regardless.

// The only caller (lib.rs setup) is release-gated: in a debug build this whole
// module is intentionally dead code.
#![cfg_attr(debug_assertions, allow(dead_code))]

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;
use tracing::info;

/// Fire-and-forget update check on a background task.
pub fn spawn_update_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        match check_and_install(&app).await {
            Ok(true) => info!("Update installed; relaunching"),
            Ok(false) => info!("No update available"),
            Err(e) => info!("Update check skipped: {e}"),
        }
    });
}

async fn check_and_install(app: &AppHandle) -> anyhow::Result<bool> {
    let updater = app.updater()?;
    let Some(update) = updater.check().await? else {
        return Ok(false);
    };

    info!(
        "Update {} available (current {}), downloading",
        update.version, update.current_version
    );

    let mut downloaded = 0usize;
    update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk;
                if let Some(total) = total {
                    info!("Update download {}/{} bytes", downloaded, total);
                }
            },
            || info!("Update download finished, installing"),
        )
        .await?;

    // Relaunch into the freshly installed version.
    app.restart();
}
