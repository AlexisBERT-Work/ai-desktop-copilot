//! Dossier de données de CatDesk, partagé par le cœur Rust et l'agent.
//!
//! L'agent le reçoit en `CATDESK_DATA_DIR` ; le journal d'audit du cœur écrit
//! sous son `audit/`, à côté de celui de l'agent. Avant, le cœur se rabattait
//! sur `%APPDATA%\CatDesk\data` pendant que l'agent écrivait dans
//! `%APPDATA%\com.catdesk.app\agent-data` : le journal « combiné » vivait dans
//! deux dossiers.

use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::{AppHandle, Manager};

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Résout (une fois) et crée le dossier de données. Le dossier d'installation
/// est en lecture seule : c'est un dossier par utilisateur.
pub fn init(app: &AppHandle) -> PathBuf {
    DATA_DIR
        .get_or_init(|| {
            let dir = app
                .path()
                .app_data_dir()
                .map(|d| d.join("agent-data"))
                .unwrap_or_else(|_| PathBuf::from("data"));
            let _ = std::fs::create_dir_all(&dir);
            dir
        })
        .clone()
}

/// Le dossier, une fois `init` appelé au démarrage.
pub fn get() -> Option<&'static PathBuf> {
    DATA_DIR.get()
}
