//! Commandes presse/dailys : revue de presse partagée (admin) et journaux
//! personnalisés locaux. Toutes relayent au sidecar agent en JSON-RPC.

use tracing::info;

use crate::ipc::bridge::send_to_agent;
use crate::ipc::protocol::{self, rpc_request};

/// Trigger an immediate press-digest run ("Publier maintenant" in the admin
/// console). Fire-and-forget: the agent publishes to Supabase and the dailys
/// arrive via Realtime. No-op on client machines (the agent replies "inactive"
/// when no admin credentials are configured).
#[tauri::command]
pub async fn run_press_digest() -> Result<(), String> {
    info!("run_press_digest");
    let payload = rpc_request(protocol::RPC_PRESS_RUN_NOW, serde_json::json!({}));
    send_to_agent(payload).await.map_err(|e| e.to_string())
}

/// Save (create or update) a LOCAL custom press feed — per-machine, no admin
/// role. The agent persists it and pushes the full list back via the
/// `press:feeds` event.
#[tauri::command]
pub async fn save_local_press_feed(feed: serde_json::Value) -> Result<(), String> {
    let payload = rpc_request(protocol::RPC_PRESS_FEEDS_SAVE, feed);
    send_to_agent(payload).await.map_err(|e| e.to_string())
}

/// Delete a LOCAL custom press feed by id.
#[tauri::command]
pub async fn delete_local_press_feed(id: String) -> Result<(), String> {
    let payload = rpc_request(
        protocol::RPC_PRESS_FEEDS_DELETE,
        serde_json::json!({ "id": id }),
    );
    send_to_agent(payload).await.map_err(|e| e.to_string())
}

/// Trigger an immediate generation of the LOCAL custom feeds ("Générer
/// maintenant"). Fire-and-forget: results arrive via the `dailies:local` event.
#[tauri::command]
pub async fn run_local_press_now() -> Result<(), String> {
    let payload = rpc_request(protocol::RPC_PRESS_LOCAL_RUN_NOW, serde_json::json!({}));
    send_to_agent(payload).await.map_err(|e| e.to_string())
}

/// Ask the agent to re-push the local press state (`press:feeds` +
/// `dailies:local` events) — used by the UI at mount, since notifications
/// emitted before the window loads are lost.
#[tauri::command]
pub async fn sync_local_press() -> Result<(), String> {
    let payload = rpc_request(protocol::RPC_PRESS_LOCAL_SYNC, serde_json::json!({}));
    send_to_agent(payload).await.map_err(|e| e.to_string())
}
