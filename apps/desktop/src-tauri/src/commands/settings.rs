use serde::Deserialize;
use tauri::AppHandle;
use tracing::info;

use crate::ipc::bridge::send_to_agent;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsArgs {
    pub safe_mode: Option<bool>,
}

/// Called from React UI when user changes settings that affect the agent runtime.
/// Forwards the update to the Node.js agent sidecar via JSON-RPC.
#[tauri::command]
pub async fn update_settings(
    app: AppHandle,
    args: UpdateSettingsArgs,
) -> Result<(), String> {
    info!(safe_mode = ?args.safe_mode, "update_settings");

    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": uuid::Uuid::new_v4().to_string(),
        "method": "settings.update",
        "params": {
            "safeMode": args.safe_mode,
        }
    });

    send_to_agent(&app, payload, String::new(), String::new())
        .await
        .map_err(|e| e.to_string())
}
