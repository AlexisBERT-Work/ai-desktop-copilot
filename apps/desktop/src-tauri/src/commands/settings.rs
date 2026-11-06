use serde::Deserialize;
use serde_json::json;
use tracing::info;

use crate::commands::forward_to_agent;
use crate::core::audit;
use crate::ipc::{bridge, protocol};

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

    let settings = json!({ "safeMode": args.safe_mode });
    // Mémorisé AVANT l'envoi : si l'agent n'est pas encore (ou plus) là, le
    // superviseur rejouera ces réglages à son démarrage.
    bridge::remember_runtime_settings(settings.clone());
    forward_to_agent(protocol::RPC_SETTINGS_UPDATE, settings).await?;

    // `safeMode` conditionne le blocage de tous les outils à risque ≥ medium :
    // son basculement doit laisser une trace, comme toute décision de sécurité.
    audit::log("SETTINGS_UPDATE", json!({ "safeMode": args.safe_mode }));
    Ok(())
}
