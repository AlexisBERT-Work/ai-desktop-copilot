use anyhow::{Context, Result};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::ChildStdin;
use tokio::sync::{Mutex, RwLock};
use tracing::{error, info, warn};

use super::protocol;

/// stdin du processus agent EN COURS — `None` avant le démarrage et entre
/// deux vies du processus. (Un `OnceCell` figeait le premier processus : s'il
/// mourait, toutes les commandes échouaient jusqu'au redémarrage de l'app.)
static AGENT_STDIN: RwLock<Option<Arc<Mutex<ChildStdin>>>> = RwLock::const_new(None);

/// Levé à la fermeture de l'app : le superviseur ne relance plus l'agent.
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

/// Un run de chat attend sa fin (`done`/`error`). Si l'agent meurt pendant,
/// l'UI doit en être avertie, sinon elle reste en « réfléchit… ».
static RUN_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

/// Derniers réglages runtime poussés par l'UI (safe mode), REJOUÉS à chaque
/// démarrage de l'agent : un agent relancé repartait sans mode sécurisé
/// pendant que l'UI l'affichait actif.
static RUNTIME_SETTINGS: std::sync::Mutex<Option<Value>> = std::sync::Mutex::new(None);

/// Relances consécutives avant abandon (un agent qui plante en boucle).
const MAX_RESTARTS: u32 = 5;
/// Un processus qui a tenu plus longtemps que ça remet le compteur à zéro.
const HEALTHY_UPTIME: Duration = Duration::from_secs(60);

/// Lance le superviseur de l'agent Node.js (tâche de fond : sûr depuis le
/// hook `setup` de Tauri). Il démarre l'agent, relaie ses messages, et le
/// relance avec un délai croissant s'il s'arrête de lui-même.
pub fn start_agent_sidecar(app: AppHandle) -> Result<()> {
    tauri::async_runtime::spawn(supervise(app));
    Ok(())
}

async fn supervise(app: AppHandle) {
    let mut failures = 0u32;
    loop {
        let started = Instant::now();
        match spawn_agent_process(&app).await {
            Ok(child) => match run_agent(&app, child).await {
                Ok(status) => warn!("Agent sidecar exited: {status}"),
                Err(e) => error!("Agent sidecar error: {e}"),
            },
            Err(e) => error!("Failed to start agent sidecar: {e}"),
        }
        *AGENT_STDIN.write().await = None;
        if SHUTTING_DOWN.load(Ordering::SeqCst) {
            return;
        }
        notify_run_lost(&app);

        if started.elapsed() >= HEALTHY_UPTIME {
            failures = 0;
        }
        failures += 1;
        if failures > MAX_RESTARTS {
            error!("Agent sidecar keeps failing — giving up after {MAX_RESTARTS} restarts");
            return;
        }
        let delay = Duration::from_secs(1 << failures.min(5)); // 2, 4, 8, 16, 32 s
        warn!("Restarting agent sidecar in {delay:?} (attempt {failures})");
        tokio::time::sleep(delay).await;
    }
}

/// L'agent est mort pendant un run : on sort l'UI de son attente.
fn notify_run_lost(app: &AppHandle) {
    if !RUN_IN_FLIGHT.swap(false, Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(
            protocol::EVENT_CHAT_ERROR,
            serde_json::json!({
                "conversationId": "",
                "code": "AGENT_EXITED",
                "message": "L'agent s'est arrêté pendant la réponse — il redémarre.",
            }),
        );
    }
}

/// Un run de chat vient d'être confié à l'agent (`chat_send`).
pub fn mark_run_started() {
    RUN_IN_FLIGHT.store(true, Ordering::SeqCst);
}

/// Mémorise les réglages runtime pour les rejouer à chaque (re)démarrage.
pub fn remember_runtime_settings(settings: Value) {
    *RUNTIME_SETTINGS.lock().unwrap_or_else(|e| e.into_inner()) = Some(settings);
}

/// Fermeture de l'app : ne plus relancer l'agent et fermer son stdin. L'agent
/// y voit la fin de stdin et s'arrête PROPREMENT (OCR, navigateur, VRAM) de
/// lui-même — un kill l'en empêcherait.
pub async fn shutdown() {
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
    AGENT_STDIN.write().await.take();
}

/// Resolved launch parameters for the Node.js agent runtime.
struct AgentLaunch {
    program: std::path::PathBuf,
    args: Vec<String>,
    work_dir: std::path::PathBuf,
    /// Extra environment variables to inject (paths to bundled binaries, data dir…).
    env: Vec<(String, String)>,
}

/// Decide how to launch the agent runtime depending on whether we run from a
/// packaged install (bundled `node.exe` + compiled `dist/`) or from the dev
/// workspace (`node --import tsx src/index.ts`).
///
/// Production layout, relative to the Tauri resource dir:
///   resources/agent/node.exe        ← portable Node runtime
///   resources/agent/dist/index.js   ← compiled agent entry
///   resources/agent/node_modules/   ← production dependencies
///   resources/ocr/ocr-sidecar.exe   ← PyInstaller-packaged OCR sidecar (optional)
fn resolve_agent_launch(app: &AppHandle) -> Result<AgentLaunch> {
    use crate::core::resources::resource_subdir;
    let bundled_agent = resource_subdir(app, "agent");

    // Per-user writable data dir (the resource dir lives in Program Files and is
    // read-only). The agent persists conversations / vector store here, and the
    // Rust audit log writes next to the agent's.
    let data_dir = crate::core::data_dir::init(app);

    let mut env: Vec<(String, String)> = vec![
        (
            "CATDESK_DATA_DIR".into(),
            data_dir.to_string_lossy().into_owned(),
        ),
        ("OLLAMA_URL".into(), crate::core::ollama::OLLAMA_URL.into()),
    ];

    // Point the agent at the bundled OCR sidecar exe when present.
    if let Some(ocr) = resource_subdir(app, "ocr") {
        let ocr_bin = ocr.join("ocr-sidecar.exe");
        if ocr_bin.exists() {
            env.push((
                "OCR_SIDECAR_BIN".into(),
                ocr_bin.to_string_lossy().into_owned(),
            ));
        }
        let tessdata = ocr.join("tessdata");
        if tessdata.exists() {
            env.push((
                "TESSDATA_PREFIX".into(),
                tessdata.to_string_lossy().into_owned(),
            ));
        }
    }

    // Production: bundled node + compiled dist exist.
    if let Some(agent) = bundled_agent {
        let node = agent.join("node.exe");
        let entry = agent.join("dist").join("index.js");
        if node.exists() && entry.exists() {
            info!("Launching bundled agent runtime");
            return Ok(AgentLaunch {
                program: node,
                args: vec![entry.to_string_lossy().into_owned()],
                work_dir: agent,
                env,
            });
        }
    }

    // Dev fallback: run TypeScript source through tsx from the workspace.
    let agent_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("packages")
        .join("agent-runtime");
    info!(
        "Launching dev agent runtime (tsx) from {}",
        agent_dir.display()
    );
    Ok(AgentLaunch {
        program: std::path::PathBuf::from("node"),
        args: vec!["--import".into(), "tsx".into(), "src/index.ts".into()],
        work_dir: agent_dir,
        env,
    })
}

/// Démarre le processus agent (résolution des paramètres + spawn), sans toucher
/// à ses flux. Séparé de `wire_agent_streams` : « comment on lance » et
/// « comment on écoute » n'ont aucune raison de changer ensemble.
async fn spawn_agent_process(app: &AppHandle) -> Result<tokio::process::Child> {
    let mut launch = resolve_agent_launch(app)?;

    // Un SEUL modèle de chat : plus de CATDESK_MODEL_SMALL — le 14b et le 7b
    // ne cohabitent pas dans 10 Go de VRAM, chaque rétrogradation forçait un
    // swap de modèle (10-20 s), plus lent que de répondre avec le modèle
    // principal déjà chaud. (Opt-in possible via l'env pour tester.)
    launch.env.push((
        "CATDESK_MODEL".into(),
        crate::core::ollama::DEFAULT_CHAT_MODEL.into(),
    ));

    let mut cmd = tokio::process::Command::new(&launch.program);
    cmd.current_dir(&launch.work_dir)
        .args(&launch.args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    for (key, value) in &launch.env {
        cmd.env(key, value);
    }

    // On Windows, prevent the spawned `node` process from popping a console
    // window (the app runs in the GUI subsystem, so a child console subprocess
    // would otherwise allocate a visible terminal the user could close).
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn().context("Failed to start agent runtime")
}

/// Branche les trois tuyaux de l'enfant — stdout (JSON-RPC → événements
/// Tauri), stderr (journal) — publie son stdin, rejoue les réglages runtime,
/// puis attend la fin du processus.
async fn run_agent(
    app: &AppHandle,
    mut child: tokio::process::Child,
) -> Result<std::process::ExitStatus> {
    let stdin = child
        .stdin
        .take()
        .context("stdin de l'agent indisponible")?;
    let stdout = child
        .stdout
        .take()
        .context("stdout de l'agent indisponible")?;
    let stderr = child
        .stderr
        .take()
        .context("stderr de l'agent indisponible")?;

    *AGENT_STDIN.write().await = Some(Arc::new(Mutex::new(stdin)));
    info!("Agent sidecar started");

    // Read stdout (JSON-RPC responses) in background task
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break,
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

    // Le stdin de l'agent est mis en tampon par l'OS jusqu'à ce qu'il le lise :
    // les réglages arrivent donc même si l'agent n'a pas fini de démarrer.
    let settings = RUNTIME_SETTINGS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    if let Some(settings) = settings {
        if let Err(e) = send_to_agent(protocol::rpc_request(
            protocol::RPC_SETTINGS_UPDATE,
            settings,
        ))
        .await
        {
            warn!("Runtime settings not replayed to the agent: {e}");
        }
    }

    child.wait().await.context("attente de l'agent")
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
            protocol::NOTIF_AGENT_STEP => {
                if let Some(window) = app.get_webview_window("main") {
                    if let Some(step) = params.get("step") {
                        dispatch_agent_step(window, step).await?;
                    }
                }
            }
            protocol::NOTIF_PERMISSION_REQUEST => {
                if let Some(window) = app.get_webview_window("main") {
                    window.emit(protocol::EVENT_PERMISSION_REQUEST, params)?;
                }
            }
            protocol::NOTIF_PROACTIVE_SUGGESTION => {
                // Agent-initiated nudge (e.g. spiral detection). Surface it in the UI.
                if let Some(window) = app.get_webview_window("main") {
                    window.emit(protocol::EVENT_PROACTIVE_SUGGESTION, params)?;
                }
            }
            protocol::NOTIF_MARKET_UPDATE => {
                // Live market snapshot — broadcast to all windows (incl. the
                // separate dashboard window).
                app.emit(protocol::EVENT_MARKET_UPDATE, params)?;
            }
            protocol::NOTIF_PRESS_FEEDS => {
                // Journaux personnalisés locaux (état complet, poussé après
                // chaque écriture ou au sync). Broadcast : le panneau vit dans
                // la fenêtre dashboard.
                app.emit(protocol::EVENT_PRESS_FEEDS, params)?;
            }
            protocol::NOTIF_DAILIES_LOCAL => {
                // Dailys générées localement par les journaux personnalisés.
                app.emit(protocol::EVENT_DAILIES_LOCAL, params)?;
            }
            protocol::NOTIF_PRESS_LOCAL_PROGRESS => {
                // Progression de la génération des dailys locales (bandeau de
                // statut du panneau « Mes journaux », fenêtre dashboard).
                app.emit(protocol::EVENT_PRESS_PROGRESS, params)?;
            }
            _ => {
                warn!("Unknown agent notification: {method}");
            }
        }
    }

    Ok(())
}

async fn dispatch_agent_step(window: tauri::WebviewWindow, step: &Value) -> Result<()> {
    let step_type = step.get("type").and_then(Value::as_str).unwrap_or("");

    // INVARIANT : le sidecar (buildStepNotification) met conversationId +
    // messageId dans chaque step. S'ils manquent, c'est un bug de contrat —
    // on le signale au lieu d'inventer des valeurs qui masqueraient le défaut.
    let conv_id = step
        .get("conversationId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let msg_id = step.get("messageId").and_then(Value::as_str).unwrap_or("");
    if conv_id.is_empty() || msg_id.is_empty() {
        warn!("agent.step sans ids de corrélation (type: {step_type})");
    }

    if step_type == "done" || step_type == "error" {
        RUN_IN_FLIGHT.store(false, Ordering::SeqCst);
    }

    match step_type {
        "token" => {
            let token = step.get("content").and_then(Value::as_str).unwrap_or("");
            window.emit(
                protocol::EVENT_CHAT_TOKEN,
                serde_json::json!({
                    "conversationId": conv_id,
                    "messageId": msg_id,
                    "token": token
                }),
            )?;
        }
        "done" => {
            window.emit(
                protocol::EVENT_CHAT_DONE,
                serde_json::json!({
                    "conversationId": conv_id,
                    "messageId": msg_id,
                    "totalTokens": step.get("totalTokens").and_then(Value::as_u64).unwrap_or(0)
                }),
            )?;
        }
        "error" => {
            window.emit(
                protocol::EVENT_CHAT_ERROR,
                serde_json::json!({
                    "conversationId": conv_id,
                    "code": step.get("code").and_then(Value::as_str).unwrap_or("ERROR"),
                    "message": step.get("content").and_then(Value::as_str).unwrap_or("Unknown error")
                }),
            )?;
        }
        "tool_start" | "tool_result" | "tool_error" | "tool_blocked" => {
            window.emit(protocol::EVENT_AGENT_TOOL_CALL, step)?;
        }
        "plan" => {
            window.emit(
                protocol::EVENT_AGENT_PLAN,
                serde_json::json!({
                    "conversationId": conv_id,
                    "messageId": msg_id,
                    "steps": step.get("steps").cloned().unwrap_or(Value::Null)
                }),
            )?;
        }
        _ => {}
    }

    Ok(())
}

/// Send a message to the agent runtime via stdin.
pub async fn send_to_agent(payload: Value) -> Result<()> {
    let stdin_lock = AGENT_STDIN
        .read()
        .await
        .clone()
        .context("agent non démarré (ou en cours de redémarrage)")?;

    let mut line = serde_json::to_string(&payload)?;
    line.push('\n');

    let mut stdin = stdin_lock.lock().await;
    stdin.write_all(line.as_bytes()).await?;
    stdin.flush().await?;

    Ok(())
}

/// Forward a permission response from React UI to the agent runtime.
pub async fn send_permission_response(
    request_id: &str,
    granted: bool,
    remember: bool,
) -> Result<()> {
    let payload = protocol::rpc_notification(
        protocol::RPC_PERMISSION_RESPONSE,
        serde_json::json!({
            "requestId": request_id,
            "granted": granted,
            "remember": remember
        }),
    );
    send_to_agent(payload).await
}
