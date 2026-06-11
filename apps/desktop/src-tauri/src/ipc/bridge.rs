use anyhow::{Context, Result};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::ChildStdin;
use tokio::sync::Mutex;
use tracing::{error, info, warn};

/// Shared stdin handle to the Node.js agent sidecar process.
static AGENT_STDIN: tokio::sync::OnceCell<Arc<Mutex<ChildStdin>>> =
    tokio::sync::OnceCell::const_new();

/// Spawn the Node.js agent runtime sidecar and wire its stdout to Tauri events.
/// Launches an async task so this is safe to call from Tauri's setup hook.
pub fn start_agent_sidecar(app: AppHandle) -> Result<()> {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = launch_sidecar(app).await {
            error!("Failed to start agent sidecar: {e}");
        }
    });
    Ok(())
}

async fn launch_sidecar(app: AppHandle) -> Result<()> {
    // The agent runtime (and its local `tsx`) live in the workspace, not next to
    // the Tauri binary. Resolve the package dir from this crate's compile-time
    // location so `tsx` and the entry path resolve regardless of process cwd.
    let agent_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("packages")
        .join("agent-runtime");

    let mut cmd = tokio::process::Command::new("node");
    cmd.current_dir(&agent_dir)
        .arg("--import")
        .arg("tsx")
        .arg("src/index.ts")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // On Windows, prevent the spawned `node` process from popping a console
    // window (the app runs in the GUI subsystem, so a child console subprocess
    // would otherwise allocate a visible terminal the user could close).
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .context("Failed to start agent runtime (dev mode)")?;

    let stdin = child.stdin.take().expect("agent stdin");
    let stdout = child.stdout.take().expect("agent stdout");
    let stderr = child.stderr.take().expect("agent stderr");

    AGENT_STDIN
        .set(Arc::new(Mutex::new(stdin)))
        .map_err(|_| anyhow::anyhow!("Agent already started"))?;

    // Read stdout (JSON-RPC responses) in background task
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stdout);
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

    // Log stderr in background task
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            if reader.read_line(&mut line).await.unwrap_or(0) == 0 {
                break;
            }
            if !line.trim().is_empty() {
                info!("[agent] {}", line.trim());
            }
        }
    });

    // Wait for child exit in background (prevents zombie processes)
    tauri::async_runtime::spawn(async move {
        match child.wait().await {
            Ok(status) => warn!("Agent sidecar exited: {status}"),
            Err(e) => error!("Agent sidecar wait error: {e}"),
        }
    });

    info!("Agent sidecar started (dev mode)");
    Ok(())
}

/// Parse a JSON-RPC message from the agent and emit appropriate Tauri events.
async fn handle_agent_message(app: &AppHandle, line: &str) -> Result<()> {
    if line.is_empty() {
        return Ok(());
    }

    let value: Value = serde_json::from_str(line).context("Invalid JSON from agent")?;

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
    _request_id: Option<Value>,
) -> Result<()> {
    let step_type = step.get("type").and_then(Value::as_str).unwrap_or("");

    let conv_id = step
        .get("conversationId")
        .and_then(Value::as_str)
        .unwrap_or("default");
    let msg_id = step
        .get("messageId")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    match step_type {
        "token" => {
            let token = step.get("content").and_then(Value::as_str).unwrap_or("");
            window.emit(
                "chat:token",
                serde_json::json!({
                    "conversationId": conv_id,
                    "messageId": msg_id,
                    "token": token
                }),
            )?;
        }
        "done" => {
            window.emit(
                "chat:done",
                serde_json::json!({
                    "conversationId": conv_id,
                    "messageId": msg_id,
                    "totalTokens": step.get("totalTokens").and_then(Value::as_u64).unwrap_or(0)
                }),
            )?;
        }
        "error" => {
            window.emit(
                "chat:error",
                serde_json::json!({
                    "conversationId": conv_id,
                    "code": step.get("code").and_then(Value::as_str).unwrap_or("ERROR"),
                    "message": step.get("content").and_then(Value::as_str).unwrap_or("Unknown error")
                }),
            )?;
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
    _app: &AppHandle,
    payload: Value,
    _conversation_id: String,
    _message_id: String,
) -> Result<()> {
    let stdin_lock = AGENT_STDIN.get().context("Agent not started")?;

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
