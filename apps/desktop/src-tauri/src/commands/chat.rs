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

    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": uuid::Uuid::new_v4().to_string(),
        "method": "agent.process",
        "params": {
            "input": args.message,
            "conversationId": args.conversation_id,
            "config": {
                "model": args.model_id,
                "useTools": args.use_tools,
                "useMemory": true,
                "useScreenContext": false
            }
        }
    });

    send_to_agent(&app, payload, args.conversation_id, args.message_id)
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
