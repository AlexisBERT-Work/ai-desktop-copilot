//! Commandes de conversation : envoi/interruption d'un run agent, et config
//! bourse poussée par le dashboard. Les commandes presse vivent dans press.rs,
//! l'inventaire de modèles/VRAM dans models.rs.

use serde::{Deserialize, Serialize};
use tracing::info;

use crate::ipc::bridge::send_to_agent;
use crate::ipc::protocol::{self, rpc_request};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSendArgs {
    pub conversation_id: String,
    pub message: String,
    pub message_id: String,
    pub model_id: String,
    pub use_tools: bool,
    /// Mode de sélection du modèle : "auto" | "light" | "code". Défaut "auto".
    #[serde(default)]
    pub model_mode: Option<String>,
    /// Modèle léger (mode light / borne basse de auto).
    #[serde(default)]
    pub light_model: Option<String>,
    /// Modèle de code/heavy (mode code / borne haute de auto).
    #[serde(default)]
    pub code_model: Option<String>,
    /// Active la phase de planification.
    #[serde(default)]
    pub use_planning: Option<bool>,
}

/// Send a chat message to the agent runtime.
/// Streaming tokens are forwarded back as "chat:token" events.
#[tauri::command]
pub async fn chat_send(args: ChatSendArgs) -> Result<(), String> {
    info!(
        conversation_id = %args.conversation_id,
        model = %args.model_id,
        "chat_send"
    );

    let mut config = serde_json::json!({
        "model": args.model_id,
        "useTools": args.use_tools,
        "useMemory": true,
        "useScreenContext": false,
        "modelMode": args.model_mode.as_deref().unwrap_or("auto"),
    });
    if let Some(light) = &args.light_model {
        config["lightModel"] = serde_json::json!(light);
    }
    if let Some(code) = &args.code_model {
        config["codeModel"] = serde_json::json!(code);
    }
    if let Some(planning) = args.use_planning {
        config["usePlanning"] = serde_json::json!(planning);
    }

    let payload = rpc_request(
        protocol::RPC_AGENT_PROCESS,
        serde_json::json!({
            "input": args.message,
            "conversationId": args.conversation_id,
            "messageId": args.message_id,
            "config": config
        }),
    );

    send_to_agent(payload).await.map_err(|e| e.to_string())
}

/// Interrupt the run currently in progress (Stop button).
#[tauri::command]
pub async fn chat_cancel() -> Result<(), String> {
    info!("chat_cancel");
    let payload = rpc_request(protocol::RPC_AGENT_CANCEL, serde_json::json!({}));
    send_to_agent(payload).await.map_err(|e| e.to_string())
}

/// A user-defined formula carried from the dashboard to the agent.
#[derive(Debug, Deserialize, Serialize)]
pub struct FormulaDef {
    pub name: String,
    pub expression: String,
}

/// Replace the live market config (watchlist + formulas) with what the dashboard
/// `stocks` widgets show. Forwarded to the agent's MarketService.
#[tauri::command]
pub async fn set_market_watchlist(
    symbols: Vec<String>,
    formulas: Vec<FormulaDef>,
) -> Result<(), String> {
    let payload = rpc_request(
        protocol::RPC_MARKET_SET_WATCHLIST,
        serde_json::json!({ "symbols": symbols, "formulas": formulas }),
    );
    send_to_agent(payload).await.map_err(|e| e.to_string())
}
