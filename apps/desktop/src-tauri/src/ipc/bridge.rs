use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;
use tracing::{error, info, warn};

/// Shared stdin handle to the Node.js agent sidecar process.
static AGENT_STDIN: tokio::sync::OnceCell<Arc<Mutex<ChildStdin>>> =
    tokio::sync::OnceCell::const_new();

/// Spawn the Node.js agent runtime sidecar and wire its stdout to Tauri events.
pub fn start_agent_sidecar(app: AppHandle) -> Result<()> {
    // Sidecar is registered in tauri.conf.json under "bundle > externalBin"
    // For dev: run via `node packages/agent-runtime/src/index.ts`
    let sidecar_cmd = if cfg!(debug_assertions) {
        // Dev mode: use tsx to run TypeScript directly
        Some(
            std::process::Command::new("node")
                .arg("--import")
                .arg("tsx")
                .arg("packages/agent-runtime/src/index.ts")
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .context("Failed to start agent runtime (dev mode)")?,
        )
    } else {
        None // Production: Tauri sidecar via tauri_plugin_shell
    };

    if let Some(child) = sidecar_cmd {
        let stdin = child.stdin.expect("agent stdin");
        let stdout = child.stdout.expect("agent stdout");
        let stderr = child.stderr.expect("agent stderr");

        // Store stdin for sending messages
        let stdin_mutex = Arc::new(Mutex::new(
            tokio::process::ChildStdin::from_std(stdin)
                .context("Converting stdin")?,
        ));

        AGENT_STDIN
            .set(stdin_mutex)
            .map_err(|_| anyhow::anyhow!("Agent already started"))?;

        // Read stdout (JSON-RPC responses) in background task
        let app_clone = app.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(
                tokio::process::ChildStdout::from_std(stdout).unwrap(),
            );
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => {
                        warn!("Agent stdout closed");
                        break;
                    }
                    Ok(_) => {
                        if let Err(e) = handle_agent_message(&app_clone, line.trim()).await {
                            error!("Agent message error: {e}");
                        }
                    }
                    Err(e) => {
                        error!("Agent stdout read error: {e}");
                        break;
                    }
                }
            }
        });

        // Log stderr
        tokio::spawn(async move {
            let mut reader = BufReader::new(
                tokio::process::ChildStderr::from_std(stderr).unwrap(),
            );
            let mut line = String::new();
            loop {
                line.clear();
                if reader.read_line(&mut line).await.unwrap_or(0) == 0 { break; }
                if !line.trim().is_empty() {
                    info!("[agent] {}", line.trim());
                }
            }
        });

        info!("Agent sidecar started (dev mode)");
    }

    Ok(())
}

/// Parse a JSON-RPC message from the agent and emit appropriate Tauri events.
async fn handle_agent_message(app: &AppHandle, line: &str) -> Result<()> {
    if line.is_empty() { return Ok(()); }

    let value: Value = serde_json::from_str(line)
        .context("Invalid JSON from agent")?;

    // JSON-RPC notification (method without id)
    if let Some(method) = value.get("method").and_then(Value::as_str) {
        let params = value.get("params").cloned().unwrap_or(Value::Null);

        match method {
            "agent.step" => {
                if let Some(window) = app.get_webview_window("main") {
                    let id = params.get("id").cloned();
                    if let Some(step) = params.get("step") {
                        dispatch_agent_step(window, step, id).await?;
                    }
                }
            }
            "permission.request" => {
                if let Some(window) = app.get_webview_window("main") {
                    window.emit("permission:request", params)?;
                }
            }
            _ => {
                warn!("Unknown agent notification: {method}");
            }
        }
    }

    Ok(())
}

async fn dispatch_agent_step(
    window: tauri::WebviewWindow,
    step: &Value,
    request_id: Option<Value>,
) -> Result<()> {
    let step_type = step.get("type").and_then(Value::as_str).unwrap_or("");

    // Extract conversation_id and message_id from request context
    // For MVP these are embedded in the step or tracked via request_id
    let conv_id = step.get("conversationId")
        .and_then(Value::as_str)
        .unwrap_or("default");
    let msg_id = step.get("messageId")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    match step_type {
        "token" => {
            let token = step.get("content").and_then(Value::as_str).unwrap_or("");
            window.emit("chat:token", serde_json::json!({
                "conversationId": conv_id,
                "messageId": msg_id,
                "token": token
            }))?;
        }
        "done" => {
            window.emit("chat:done", serde_json::json!({
                "conversationId": conv_id,
                "messageId": msg_id,
                "totalTokens": step.get("totalTokens").and_then(Value::as_u64).unwrap_or(0)
            }))?;
        }
        "error" => {
            window.emit("chat:error", serde_json::json!({
                "conversationId": conv_id,
                "code": step.get("code").and_then(Value::as_str).unwrap_or("ERROR"),
                "message": step.get("content").and_then(Value::as_str).unwrap_or("Unknown error")
            }))?;
        }
        "tool_start" | "tool_result" | "tool_error" | "tool_blocked" => {
            window.emit("agent:tool_call", step)?;
        }
        _ => {}
    }

    Ok(())
}

/// Send a message to the agent runtime via stdin.
pub async fn send_to_agent(
    app: &AppHandle,
    payload: Value,
    conversation_id: String,
    message_id: String,
) -> Result<()> {
    let stdin_lock = AGENT_STDIN.get()
        .context("Agent not started")?;

    let mut line = serde_json::to_string(&payload)?;
    line.push('\n');

    let mut stdin = stdin_lock.lock().await;
    stdin.write_all(line.as_bytes()).await?;
    stdin.flush().await?;

    Ok(())
}

/// Forward a permission response from React UI to the agent runtime.
pub async fn send_permission_response(
    app: &AppHandle,
    request_id: &str,
    granted: bool,
    remember: bool,
) -> Result<()> {
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "permission.response",
        "params": {
            "requestId": request_id,
            "granted": granted,
            "remember": remember
        }
    });
    send_to_agent(app, payload, String::new(), String::new()).await
}
