//! Locate bundled resource subdirectories at runtime.
//!
//! Depending on how Tauri lays out `bundle.resources`, a mapped folder may land
//! directly under the resource dir (`<res>/agent`) or nested under a `resources/`
//! segment (`<res>/resources/agent`). We probe both so the rest of the code
//! doesn't have to care.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Return the path to a bundled resource subdirectory (e.g. "agent", "ollama",
/// "ocr") if it exists, trying the common Tauri layouts.
pub fn resource_subdir(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let base = app.path().resource_dir().ok()?;
    [base.join(name), base.join("resources").join(name)]
        .into_iter()
        .find(|candidate| candidate.exists())
}
