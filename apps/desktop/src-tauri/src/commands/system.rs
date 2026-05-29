use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;
use tracing::{info, warn};

use crate::core::{audit, sandbox};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCommandArgs {
    pub command: String,
    pub shell: String,
    pub workdir: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: u64,
}

#[tauri::command]
pub async fn system_run_command(
    args: RunCommandArgs,
) -> Result<CommandOutput, String> {
    // Validate shell
    let (program, flag) = match args.shell.as_str() {
        "powershell" => ("powershell.exe", "-Command"),
        "cmd"        => ("cmd.exe", "/C"),
        other        => return Err(format!("Shell non supporté: {other}")),
    };

    // Safety check
    sandbox::check_command(&args.command).map_err(|e| e.to_string())?;

    let timeout_ms = args.timeout_ms.unwrap_or(30_000).min(120_000);
    let started = std::time::Instant::now();

    info!(command = %args.command, shell = %args.shell, "Executing command");
    audit::log_command(&args.command, &args.shell);

    let result = timeout(
        Duration::from_millis(timeout_ms),
        Command::new(program)
            .arg(flag)
            .arg(&args.command)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_clear()
            .envs([
                ("PATH", std::env::var("PATH").unwrap_or_default()),
                ("TEMP", std::env::temp_dir().to_string_lossy().to_string()),
                ("USERPROFILE", std::env::var("USERPROFILE").unwrap_or_default()),
            ])
            .current_dir(args.workdir.as_deref().unwrap_or("."))
            .output(),
    )
    .await
    .map_err(|_| "Timeout: commande trop longue".to_string())?
    .map_err(|e| e.to_string())?;

    let duration_ms = started.elapsed().as_millis() as u64;

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&result.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&result.stderr).into_owned(),
        exit_code: result.status.code().unwrap_or(-1),
        duration_ms,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAppArgs {
    pub name: String,
    pub args: Option<String>,
}

#[tauri::command]
pub async fn open_application(args: OpenAppArgs) -> Result<(), String> {
    info!(app = %args.name, "Opening application");

    Command::new(&args.name)
        .args(args.args.as_deref().unwrap_or("").split_whitespace())
        .spawn()
        .map_err(|e| format!("Impossible d'ouvrir {}: {e}", args.name))?;

    Ok(())
}
