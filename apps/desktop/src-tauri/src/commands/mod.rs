pub mod chat;
pub mod models;
pub mod permissions;
pub mod press;
pub mod settings;
pub mod tuning;
pub mod voice;

use crate::core::error::CatdeskError;
use crate::ipc::bridge::send_to_agent;
use crate::ipc::protocol::rpc_request;

/// Relaie une requête JSON-RPC au sidecar agent.
///
/// Neuf commandes (press, chat, settings) avaient exactement ce corps :
/// construire la requête, l'envoyer, aplatir l'erreur. Le passage par
/// `CatdeskError::Agent` garantit au passage un message d'erreur en français
/// côté UI, là où `.map_err(|e| e.to_string())` faisait remonter le texte brut
/// d'anyhow (« Agent not started »).
pub async fn forward_to_agent(method: &str, params: serde_json::Value) -> Result<(), String> {
    send_to_agent(rpc_request(method, params))
        .await
        .map_err(|e| CatdeskError::Agent(e.to_string()).into())
}
