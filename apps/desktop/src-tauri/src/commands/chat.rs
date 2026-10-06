//! Commandes de conversation : envoi/interruption d'un run agent, et config
//! bourse poussée par le dashboard. Les commandes presse vivent dans press.rs,
//! l'inventaire de modèles/VRAM dans models.rs.

use serde::{Deserialize, Serialize};
use tracing::info;

use crate::commands::forward_to_agent;
use crate::ipc::{bridge, protocol};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSendArgs {
    pub conversation_id: String,
    pub message: String,
    pub message_id: String,
    pub model_id: String,
    /// Réglages › Modèle. Absents → défauts de l'agent (0,7 et 10).
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_iterations: Option<u32>,
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

/// Config d'un run telle que l'agent l'attend (`AgentConfig`). Seuls les
/// champs fournis sont transmis : l'agent applique ses défauts aux autres.
fn agent_config(args: &ChatSendArgs) -> serde_json::Value {
    let mut config = serde_json::json!({
        "model": args.model_id,
        "modelMode": args.model_mode.as_deref().unwrap_or("auto"),
    });
    if let Some(t) = args.temperature {
        // Bornes du curseur des réglages ; une valeur hors bornes ne passe pas.
        config["temperature"] = serde_json::json!(t.clamp(0.0, 2.0));
    }
    if let Some(n) = args.max_iterations {
        config["maxIterations"] = serde_json::json!(n.clamp(1, 25));
    }
    if let Some(light) = &args.light_model {
        config["lightModel"] = serde_json::json!(light);
    }
    if let Some(code) = &args.code_model {
        config["codeModel"] = serde_json::json!(code);
    }
    if let Some(planning) = args.use_planning {
        config["usePlanning"] = serde_json::json!(planning);
    }
    config
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

    forward_to_agent(
        protocol::RPC_AGENT_PROCESS,
        serde_json::json!({
            "input": args.message,
            "conversationId": args.conversation_id,
            "messageId": args.message_id,
            "config": agent_config(&args),
        }),
    )
    .await?;
    bridge::mark_run_started();
    Ok(())
}

/// Interrupt the run currently in progress (Stop button).
#[tauri::command]
pub async fn chat_cancel() -> Result<(), String> {
    info!("chat_cancel");
    forward_to_agent(protocol::RPC_AGENT_CANCEL, serde_json::json!({})).await
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
    forward_to_agent(
        protocol::RPC_MARKET_SET_WATCHLIST,
        serde_json::json!({ "symbols": symbols, "formulas": formulas }),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args() -> ChatSendArgs {
        serde_json::from_value(serde_json::json!({
            "conversationId": "c",
            "message": "salut",
            "messageId": "m",
            "modelId": "qwen3:14b",
        }))
        .expect("arguments minimaux valides")
    }

    #[test]
    fn sans_reglages_l_agent_garde_ses_defauts() {
        let config = agent_config(&args());
        assert_eq!(config["model"], "qwen3:14b");
        assert_eq!(config["modelMode"], "auto");
        assert!(config.get("temperature").is_none());
        assert!(config.get("maxIterations").is_none());
    }

    #[test]
    fn les_reglages_du_modele_sont_transmis_et_bornes() {
        let mut a = args();
        a.temperature = Some(5.0);
        a.max_iterations = Some(0);
        let config = agent_config(&a);
        assert_eq!(config["temperature"], 2.0);
        assert_eq!(config["maxIterations"], 1);
    }
}
