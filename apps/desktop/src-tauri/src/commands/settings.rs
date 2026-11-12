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
    /// Navigateur de l'agent en lecture seule (aucun POST, formulaire ni WebSocket).
    pub browser_read_only: Option<bool>,
}

/// Called from React UI when user changes settings that affect the agent runtime.
/// Forwards the update to the Node.js agent sidecar via JSON-RPC.
#[tauri::command]
pub async fn update_settings(args: UpdateSettingsArgs) -> Result<(), String> {
    info!(
        safe_mode = ?args.safe_mode,
        browser_read_only = ?args.browser_read_only,
        "update_settings"
    );

    // L'UI envoie toujours les deux : ce qui est mémorisé ici REMPLACE le
    // précédent, et un réglage absent serait perdu au redémarrage de l'agent.
    let settings = json!({
        "safeMode": args.safe_mode,
        "browserReadOnly": args.browser_read_only,
    });
    // Mémorisé AVANT l'envoi : si l'agent n'est pas encore (ou plus) là, le
    // superviseur rejouera ces réglages à son démarrage.
    bridge::remember_runtime_settings(settings.clone());
    forward_to_agent(protocol::RPC_SETTINGS_UPDATE, settings.clone()).await?;

    // `safeMode` conditionne le blocage de tous les outils à risque ≥ medium, la
    // lecture seule ce que le navigateur peut envoyer : leur basculement doit
    // laisser une trace, comme toute décision de sécurité.
    audit::log("SETTINGS_UPDATE", settings);
    Ok(())
}
