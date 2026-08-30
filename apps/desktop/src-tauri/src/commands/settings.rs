use serde::Deserialize;
use serde_json::json;
use tracing::info;

use crate::commands::forward_to_agent;
use crate::core::audit;
use crate::ipc::protocol;

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

    forward_to_agent(
        protocol::RPC_SETTINGS_UPDATE,
        json!({ "safeMode": args.safe_mode }),
    )
    .await?;

    // `safeMode` conditionne le blocage de tous les outils à risque ≥ medium :
    // son basculement doit laisser une trace, comme toute décision de sécurité.
    audit::log("SETTINGS_UPDATE", json!({ "safeMode": args.safe_mode }));
    Ok(())
}
