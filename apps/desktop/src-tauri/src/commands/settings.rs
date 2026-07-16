use serde::Deserialize;
use tracing::info;

use crate::ipc::bridge::send_to_agent;
use crate::ipc::protocol::{self, rpc_request};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsArgs {
    pub safe_mode: Option<bool>,
}

/// Called from React UI when user changes settings that affect the agent runtime.
/// Forwards the update to the Node.js agent sidecar via JSON-RPC.
#[tauri::command]
pub async fn update_settings(args: UpdateSettingsArgs) -> Result<(), String> {
    info!(safe_mode = ?args.safe_mode, "update_settings");

    let payload = rpc_request(
        protocol::RPC_SETTINGS_UPDATE,
        serde_json::json!({ "safeMode": args.safe_mode }),
    );

    send_to_agent(payload).await.map_err(|e| e.to_string())
}
