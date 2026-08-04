//! GPU performance auto-tuning: recommend (and, on a managed Ollama, apply) the
//! KV-cache type that fits the machine best.
//!
//! Measured on an RX 6700 (10 GB): 4-bit KV cache (`q4_0`) costs ~6% generation
//! speed but frees ~75% of the KV memory. For a model that comfortably fits VRAM
//! that's a pure loss; for a VRAM-tight model it pulls spilled layers back onto
//! the GPU (measured +51% on a 14B). So the rule is simply: enable q4_0 only when
//! the model would otherwise be VRAM-tight.

use serde::Serialize;
use tauri::AppHandle;
use tracing::info;

use crate::commands::models::{detect_vram_bytes, heaviest_model};
use crate::core::ollama;

/// Heuristic: which KV-cache type suits a model of `model_bytes` on a GPU with
/// `vram_bytes`. Returns "f16" (comfortable fit — don't pay the ~6% q4 cost) or
/// "q4_0" (VRAM-tight — q4 frees memory to keep layers on the GPU). Unknown VRAM
/// or model → "f16" (the safe default).
pub fn recommend_kv_cache(vram_bytes: Option<u64>, model_bytes: u64) -> &'static str {
    let vram = match vram_bytes {
        Some(v) if v > 0 => v,
        _ => return "f16",
    };
    if model_bytes == 0 {
        return "f16";
    }
    // Compute/OS overhead that loads alongside the weights, plus a rough f16 KV
    // estimate (~15% of the weights at a typical local context). If weights + KV
    // + overhead fit, f16 is comfortable; otherwise q4 helps.
    const OVERHEAD: u64 = 1 << 30; // ~1 GiB
    let need_f16 = model_bytes + model_bytes * 15 / 100 + OVERHEAD;
    if vram >= need_f16 {
        "f16"
    } else {
        "q4_0"
    }
}

/// The single bundled chat model: `qwen3:14b`. Since the "one model, the
/// strongest" cut (target machines have a real GPU, ~10 GiB VRAM), the 7B tier
/// was dropped from the bundle — there is nothing left to route to, so this
/// always returns the 14B. `_vram_bytes` is kept for call-site compatibility
/// (the KV-cache tuner and UI still probe VRAM) but no longer drives the choice.
pub fn recommend_default_model(_vram_bytes: Option<u64>) -> &'static str {
    "qwen3:14b"
}

/// Detect VRAM and return the model CatDesk should default to on this machine.
#[tauri::command]
pub async fn get_recommended_model() -> Result<String, String> {
    Ok(recommend_default_model(detect_vram_bytes().await).to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KvCacheStatus {
    /// Setting CatDesk currently applies when it spawns Ollama ("f16" | "q4_0").
    pub current: String,
    /// What the heuristic recommends for this hardware + heaviest model.
    pub recommended: String,
    /// True when CatDesk manages Ollama and can apply with one click. When false
    /// (external Ollama), the UI shows the manual env-var instructions instead.
    pub managed: bool,
    /// Detected GPU VRAM in bytes, or null when undetectable.
    pub vram_bytes: Option<u64>,
    /// Heaviest installed (non-embedding) model the recommendation is based on.
    pub model_name: Option<String>,
    pub model_bytes: u64,
}

/// Detect VRAM + heaviest model and report the current/recommended KV-cache type.
#[tauri::command]
pub async fn get_kv_cache_status(app: AppHandle) -> Result<KvCacheStatus, String> {
    let vram_bytes = detect_vram_bytes().await;
    let heaviest = heaviest_model().await;
    let (model_name, model_bytes) = match heaviest {
        Some(m) => (Some(m.name), m.size_bytes),
        None => (None, 0),
    };
    let recommended = recommend_kv_cache(vram_bytes, model_bytes).to_string();
    Ok(KvCacheStatus {
        current: ollama::kv_cache_setting(&app),
        recommended,
        managed: ollama::is_managed(),
        vram_bytes,
        model_name,
        model_bytes,
    })
}

/// Poll Ollama until it answers or `max_secs` elapses. Returns readiness.
async fn wait_until_ready(max_secs: u64) -> bool {
    for _ in 0..(max_secs * 2) {
        let ok = reqwest::get("http://127.0.0.1:11434/api/tags")
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false);
        if ok {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    false
}

/// Full-auto tuning: on a managed Ollama's FIRST run (no choice made yet), wait
/// until it's ready, then apply the recommended KV-cache type once — restarting
/// Ollama only if the recommendation differs from the f16 it spawned with.
///
/// No-op when a choice already exists (auto or manual) or when Ollama is external
/// (`is_managed` false) — we never silently override a user's own setup. Runs in
/// the background so it never blocks startup.
pub fn spawn_auto_tune(app: AppHandle) {
    if ollama::kv_cache_decided(&app) {
        return; // already decided — respect it
    }
    tauri::async_runtime::spawn(async move {
        if !wait_until_ready(30).await {
            return; // Ollama never came up — try again next launch
        }
        if !ollama::is_managed() {
            return; // external Ollama — never touch it
        }
        let vram = detect_vram_bytes().await;
        let model_bytes = heaviest_model().await.map(|m| m.size_bytes).unwrap_or(0);
        let rec = recommend_kv_cache(vram, model_bytes);
        if ollama::set_kv_cache_setting(&app, rec).is_err() {
            return;
        }
        info!(recommended = rec, vram_bytes = ?vram, model_bytes, "auto-tune: KV cache decided");
        if rec != "f16" {
            // Spawned with the f16 default → restart to apply. Cheap this early:
            // no model is loaded yet.
            let app2 = app.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || ollama::restart(&app2)).await;
        }
    });
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    /// True when the change is live now (managed Ollama was restarted). When
    /// false, the setting is saved and applies at the next CatDesk launch.
    pub restarted: bool,
}

/// Persist a KV-cache type and, on a managed Ollama, restart it so the change is
/// live immediately. Value must be "f16" or "q4_0".
#[tauri::command]
pub async fn set_kv_cache_type(app: AppHandle, value: String) -> Result<ApplyResult, String> {
    info!(value = %value, "set_kv_cache_type");
    ollama::set_kv_cache_setting(&app, &value).map_err(|e| e.to_string())?;
    // Restart on a background thread (kill + respawn blocks briefly).
    let restarted = if ollama::is_managed() {
        let app2 = app.clone();
        tauri::async_runtime::spawn_blocking(move || ollama::restart(&app2))
            .await
            .map_err(|e| e.to_string())?
    } else {
        false
    };
    Ok(ApplyResult { restarted })
}

#[cfg(test)]
mod tests {
    use super::{recommend_default_model, recommend_kv_cache};

    const GIB: u64 = 1 << 30;

    #[test]
    fn always_picks_the_single_bundled_14b() {
        // The 7B tier was removed from the bundle: only qwen3:14b ships now, so
        // the choice no longer depends on VRAM.
        assert_eq!(recommend_default_model(None), "qwen3:14b");
        assert_eq!(recommend_default_model(Some(0)), "qwen3:14b");
        assert_eq!(recommend_default_model(Some(8 * GIB)), "qwen3:14b");
        assert_eq!(recommend_default_model(Some(12 * GIB)), "qwen3:14b");
    }

    #[test]
    fn unknown_vram_defaults_to_f16() {
        assert_eq!(recommend_kv_cache(None, 9_000_000_000), "f16");
        assert_eq!(recommend_kv_cache(Some(0), 9_000_000_000), "f16");
    }

    #[test]
    fn no_model_defaults_to_f16() {
        assert_eq!(recommend_kv_cache(Some(10 * GIB), 0), "f16");
    }

    #[test]
    fn comfortable_fit_stays_f16() {
        // 7B (~4.7 GB) on 10 GiB: weights*1.15 + 1 GiB ≈ 6.4 GB << 10.7 GiB.
        assert_eq!(recommend_kv_cache(Some(10 * GIB), 4_700_000_000), "f16");
        // A 3B is trivially comfortable.
        assert_eq!(recommend_kv_cache(Some(10 * GIB), 1_900_000_000), "f16");
    }

    #[test]
    fn vram_tight_model_recommends_q4() {
        // 14B (~9.0 GB) on 10 GiB: ~11.4 GB needed in f16 > 10.7 GiB → q4_0.
        assert_eq!(recommend_kv_cache(Some(10 * GIB), 9_000_000_000), "q4_0");
    }

    #[test]
    fn same_model_fits_on_a_bigger_gpu() {
        // The 14B is comfortable on a 24 GB card → no need for q4.
        assert_eq!(recommend_kv_cache(Some(24 * GIB), 9_000_000_000), "f16");
    }
}
