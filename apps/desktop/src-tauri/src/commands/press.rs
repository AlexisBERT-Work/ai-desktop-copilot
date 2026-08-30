//! Commandes presse/dailys : revue de presse partagée (admin) et journaux
//! personnalisés locaux. Toutes relayent au sidecar agent en JSON-RPC — voir
//! `forward_to_agent`, qui porte la conversion d'erreur et évite de réécrire
//! cinq fois le même corps de fonction.

use serde_json::json;
use tracing::info;

use crate::commands::forward_to_agent;
use crate::core::audit;
use crate::ipc::protocol;

/// Trigger an immediate press-digest run ("Publier maintenant" in the admin
/// console). Fire-and-forget: the agent publishes to Supabase and the dailys
/// arrive via Realtime. No-op on client machines (the agent replies "inactive"
/// when no admin credentials are configured).
#[tauri::command]
pub async fn run_press_digest() -> Result<(), String> {
    info!("run_press_digest");
    forward_to_agent(protocol::RPC_PRESS_RUN_NOW, json!({})).await?;
    audit::log("PRESS_DIGEST_RUN", json!({}));
    Ok(())
}

/// Save (create or update) a LOCAL custom press feed — per-machine, no admin
/// role. The agent persists it and pushes the full list back via the
/// `press:feeds` event.
#[tauri::command]
pub async fn save_local_press_feed(feed: serde_json::Value) -> Result<(), String> {
    let id = feed
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("<nouveau>");
    let name = feed.get("name").and_then(|v| v.as_str()).unwrap_or("");
    forward_to_agent(protocol::RPC_PRESS_FEEDS_SAVE, feed.clone()).await?;
    audit::log("PRESS_FEED_SAVE", json!({ "id": id, "name": name }));
    Ok(())
}

/// Delete a LOCAL custom press feed by id.
#[tauri::command]
pub async fn delete_local_press_feed(id: String) -> Result<(), String> {
    forward_to_agent(protocol::RPC_PRESS_FEEDS_DELETE, json!({ "id": id })).await?;
    audit::log("PRESS_FEED_DELETE", json!({ "id": id }));
    Ok(())
}

/// Trigger an immediate generation of the LOCAL custom feeds ("Générer
/// maintenant"). Fire-and-forget: results arrive via the `dailies:local` event.
#[tauri::command]
pub async fn run_local_press_now() -> Result<(), String> {
    forward_to_agent(protocol::RPC_PRESS_LOCAL_RUN_NOW, json!({})).await?;
    audit::log("PRESS_LOCAL_RUN", json!({}));
    Ok(())
}

/// Ask the agent to re-push the local press state (`press:feeds` +
/// `dailies:local` events) — used by the UI at mount, since notifications
/// emitted before the window loads are lost. Lecture seule : pas d'audit.
#[tauri::command]
pub async fn sync_local_press() -> Result<(), String> {
    forward_to_agent(protocol::RPC_PRESS_LOCAL_SYNC, json!({})).await
}
