use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tracing::{error, info};

use crate::ipc::bridge::send_to_agent;

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenEvent {
    pub conversation_id: String,
    pub message_id: String,
    pub token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoneEvent {
    pub conversation_id: String,
    pub message_id: String,
    pub total_tokens: u32,
    pub duration_ms: u64,
}

/// Send a chat message to the agent runtime.
/// Streaming tokens are forwarded back as "chat:token" events.
#[tauri::command]
pub async fn chat_send(
    app: AppHandle,
    args: ChatSendArgs,
) -> Result<(), String> {
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

    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": uuid::Uuid::new_v4().to_string(),
        "method": "agent.process",
        "params": {
            "input": args.message,
            "conversationId": args.conversation_id,
            "messageId": args.message_id,
            "config": config
        }
    });

    send_to_agent(&app, payload, args.conversation_id, args.message_id)
        .await
        .map_err(|e| e.to_string())
}

/// Interrupt the run currently in progress (Stop button).
#[tauri::command]
pub async fn chat_cancel(app: AppHandle) -> Result<(), String> {
    info!("chat_cancel");
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": uuid::Uuid::new_v4().to_string(),
        "method": "agent.cancel",
        "params": {}
    });
    send_to_agent(&app, payload, String::new(), String::new())
        .await
        .map_err(|e| e.to_string())
}

/// List locally available Ollama models.
#[tauri::command]
pub async fn get_ollama_models() -> Result<Vec<String>, String> {
    let response = reqwest::get("http://127.0.0.1:11434/api/tags")
        .await
        .map_err(|e| format!("Ollama non disponible: {e}"))?;

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {e}"))?;

    let models = json["models"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["name"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    Ok(models)
}
