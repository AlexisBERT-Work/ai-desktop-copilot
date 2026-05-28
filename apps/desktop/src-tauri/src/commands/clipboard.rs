use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tracing::info;

#[tauri::command]
pub async fn clipboard_read(app: AppHandle) -> Result<String, String> {
    info!("Clipboard read");
    app.clipboard().read_text().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clipboard_write(app: AppHandle, content: String) -> Result<(), String> {
    info!(len = content.len(), "Clipboard write");
    app.clipboard()
        .write_text(content)
        .map_err(|e| e.to_string())
}
