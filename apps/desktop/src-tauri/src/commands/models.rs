//! Inventaire des modèles Ollama locaux et détection de la VRAM GPU —
//! alimente les avertissements de l'UI et l'auto-tune (commands/tuning.rs).

use serde::Serialize;

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub name: String,
    /// On-disk size in bytes — a good proxy for the model's VRAM weight
    /// footprint at its quantization.
    pub size_bytes: u64,
}

/// List local Ollama models with their size, so the UI can warn when a model
/// is too large for the machine's VRAM.
#[tauri::command]
pub async fn get_ollama_models_info() -> Result<Vec<ModelInfo>, String> {
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
                .filter_map(|m| {
                    let name = m["name"].as_str()?.to_string();
                    let size_bytes = m["size"].as_u64().unwrap_or(0);
                    Some(ModelInfo { name, size_bytes })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(models)
}

/// Best-effort total VRAM of the primary GPU, in bytes. `None` when it cannot
/// be determined (the UI then simply skips the "too powerful" warning rather
/// than guessing). Tries NVIDIA first (covers most discrete/strong GPUs), then
/// a Windows registry fallback for AMD/Intel.
#[tauri::command]
pub async fn get_gpu_vram_bytes() -> Result<Option<u64>, String> {
    Ok(detect_vram_bytes().await)
}

/// The heaviest locally-installed model (largest on-disk size), ignoring
/// embedding models — a good proxy for the model whose VRAM fit actually
/// matters. `None` when Ollama is unreachable or has no non-embedding model.
pub(crate) async fn heaviest_model() -> Option<ModelInfo> {
    let response = reqwest::get("http://127.0.0.1:11434/api/tags").await.ok()?;
    let json: serde_json::Value = response.json().await.ok()?;
    json["models"]
        .as_array()?
        .iter()
        .filter_map(|m| {
            let name = m["name"].as_str()?.to_string();
            // Embedding models never dominate VRAM; skip them.
            if name.contains("embed") {
                return None;
            }
            Some(ModelInfo {
                name,
                size_bytes: m["size"].as_u64().unwrap_or(0),
            })
        })
        .max_by_key(|m| m.size_bytes)
}

pub(crate) async fn detect_vram_bytes() -> Option<u64> {
    if let Some(v) = nvidia_vram().await {
        return Some(v);
    }
    #[cfg(windows)]
    if let Some(v) = windows_registry_vram().await {
        return Some(v);
    }
    None
}

/// Build a Command that does not pop a console window on Windows.
fn quiet_command(program: &str) -> tokio::process::Command {
    let cmd = tokio::process::Command::new(program);
    #[cfg(windows)]
    {
        let mut cmd = cmd;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
        return cmd;
    }
    #[cfg(not(windows))]
    cmd
}

async fn nvidia_vram() -> Option<u64> {
    let out = quiet_command("nvidia-smi")
        .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    // One line of MiB per GPU; take the largest single GPU (Ollama uses one).
    text.lines()
        .filter_map(|l| l.trim().parse::<u64>().ok())
        .max()
        .map(|mib| mib * 1024 * 1024)
}

#[cfg(windows)]
async fn windows_registry_vram() -> Option<u64> {
    // qwMemorySize is the only reliable VRAM figure on Windows — the WMI
    // AdapterRAM field caps at 4 GB due to its 32-bit type.
    let script = r#"$k='HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'; (Get-ChildItem $k -ErrorAction SilentlyContinue | ForEach-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).'HardwareInformation.qwMemorySize' } | Where-Object { $_ } | Measure-Object -Maximum).Maximum"#;
    let out = quiet_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<u64>()
        .ok()
        .filter(|&v| v > 0)
}
