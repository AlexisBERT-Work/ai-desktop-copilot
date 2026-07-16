use serde_json::json;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tracing::info;

use crate::core::audit;

#[tauri::command]
pub async fn clipboard_read(app: AppHandle) -> Result<String, String> {
    info!("Clipboard read");
    app.clipboard().read_text().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clipboard_write(app: AppHandle, content: String) -> Result<(), String> {
    let len = content.len();
    info!(len, "Clipboard write");
    app.clipboard()
        .write_text(content)
        .map_err(|e| e.to_string())?;
    // Le contenu du presse-papiers n'est jamais journalisé (donnée sensible).
    audit::log("CLIPBOARD_WRITE", json!({ "bytes": len }));
    Ok(())
}
