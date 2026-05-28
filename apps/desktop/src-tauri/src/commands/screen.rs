use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use tracing::info;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureArgs {
    pub region: Option<ScreenRegion>,
    pub active_window_only: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ScreenRegion {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Captures the screen (or a region) and returns a base64-encoded PNG.
#[tauri::command]
pub async fn screen_capture(args: CaptureArgs) -> Result<String, String> {
    info!("Screen capture requested");

    // For MVP: instruct Python sidecar to do the capture
    // (mss Python library is simpler than raw WinAPI for cross-monitor support)
    // In production, this would call the Python sidecar via IPC

    // Stub: return empty string until sidecar is wired
    Ok(String::new())
}

/// Captures only the active foreground window.
#[tauri::command]
pub async fn screen_capture_active_window() -> Result<String, String> {
    info!("Active window capture requested");
    // Stub for MVP — implemented in Phase 2 via Python sidecar
    Ok(String::new())
}
