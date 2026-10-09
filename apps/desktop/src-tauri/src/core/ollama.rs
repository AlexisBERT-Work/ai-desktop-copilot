//! Embedded Ollama lifecycle.
//!
//! A packaged CatDesk install ships its own `ollama.exe` and (in the big
//! initial installer) the model blobs, so the app works offline on a machine
//! that has never seen Ollama. On startup we:
//!   1. seed the persistent per-user models dir from the bundled models the
//!      first time (see below) — this is what makes app updates lightweight;
//!   2. probe `http://127.0.0.1:11434` — if something already answers (the user
//!      has their own Ollama running), we reuse it and do nothing;
//!   3. otherwise spawn the bundled `ollama serve`, with `OLLAMA_MODELS` pointed
//!      at the persistent models dir.
//!
//! ## Why a persistent models dir
//!
//! The model is several GB and never changes between app versions. App updates
//! ship only code (small). So we keep models OUT of the versioned install dir:
//!   - the big initial installer bundles `resources/ollama/models`;
//!   - on first run we MOVE them to `%LOCALAPPDATA%\<id>\ollama-models`
//!     (instant rename, same volume — no disk doubling);
//!   - every later launch (and every update, which ships no model) reuses that
//!     persistent copy.
//!
//! In dev (no bundled binary) this is a no-op: the developer runs their own
//! Ollama, exactly as before.

use crate::core::process_tree::ProcessTree;
use crate::core::resources::resource_subdir;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tracing::{info, warn};

/// Adresse du serveur Ollama local (embarqué ou externe).
pub const OLLAMA_ADDR: &str = "127.0.0.1:11434";
/// URL de base de l'API Ollama — miroir de `OLLAMA_DEFAULT_URL` (shared-types).
pub const OLLAMA_URL: &str = "http://127.0.0.1:11434";
/// Modèle de chat unique du bundle — miroir de `DEFAULT_CHAT_MODEL` (shared-types).
pub const DEFAULT_CHAT_MODEL: &str = "qwen3:14b";

/// Client HTTP des appels à Ollama depuis le cœur : AVEC délai. `reqwest::get`
/// n'en a aucun — un Ollama figé gelait la commande, donc l'écran de réglages.
pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_default()
}

/// Le processus `ollama serve` lancé par CatDesk, gardé pour pouvoir l'arrêter,
/// avec l'arbre qui emporte ses runners `llama-server` (voir process_tree).
static MANAGED_CHILD: Mutex<Option<(Child, Option<ProcessTree>)>> = Mutex::new(None);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// True once CatDesk has spawned its OWN bundled Ollama (vs. reusing an external
/// one). Only then may we apply a KV-cache setting / restart it — we must never
/// touch an Ollama the user runs themselves.
static MANAGED: AtomicBool = AtomicBool::new(false);

/// Whether CatDesk manages the Ollama process (can apply a KV-cache setting and
/// restart it with one click). False when reusing an external/dev Ollama.
pub fn is_managed() -> bool {
    MANAGED.load(Ordering::Relaxed)
}

// ─── KV-cache setting (persisted, applied when we spawn Ollama) ───────────────

fn kv_cache_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|d| d.join("ollama-kv-cache.txt"))
}

/// The persisted KV-cache type CatDesk applies when spawning Ollama. "f16" (the
/// safe default) when nothing valid has been chosen. Only "f16" and "q4_0" are
/// accepted — anything else falls back to "f16".
pub fn kv_cache_setting(app: &AppHandle) -> String {
    kv_cache_file(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| s == "f16" || s == "q4_0")
        .unwrap_or_else(|| "f16".to_string())
}

/// Whether a KV-cache choice has ever been made (auto-tuned or set by hand).
/// While false on a managed Ollama, auto-tune may pick a value; once true, the
/// choice is respected and never silently overridden.
pub fn kv_cache_decided(app: &AppHandle) -> bool {
    kv_cache_file(app).map(|p| p.exists()).unwrap_or(false)
}

/// Persist the KV-cache setting. Validates the value. Caller restarts Ollama
/// (managed only) for it to take effect now; otherwise it applies next launch.
pub fn set_kv_cache_setting(app: &AppHandle, value: &str) -> std::io::Result<()> {
    if value != "f16" && value != "q4_0" {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "kv cache type must be f16 or q4_0",
        ));
    }
    let path = kv_cache_file(app)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no app data dir"))?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(path, value)
}

/// Start the bundled Ollama server if one isn't already listening.
/// Never fails the app launch: logs and returns on any problem.
pub fn ensure_ollama_running(app: &AppHandle) {
    let ollama_dir = match resource_subdir(app, "ollama") {
        Some(dir) => dir,
        None => {
            info!("No bundled Ollama (dev mode) — expecting an external server on :11434");
            return;
        }
    };

    let ollama_bin = ollama_dir.join("ollama.exe");
    if !ollama_bin.exists() {
        info!("No bundled Ollama binary — expecting an external server on :11434");
        return;
    }

    // Persistent, writable, update-surviving models dir.
    let persistent_models = app
        .path()
        .app_local_data_dir()
        .map(|d| d.join("ollama-models"))
        .unwrap_or_else(|_| ollama_dir.join("models"));

    // Seed it once from the bundled models (present only in the big initial
    // installer). Cheap no-op on every subsequent launch.
    seed_models(&ollama_dir.join("models"), &persistent_models);

    let bin = ollama_bin;
    let models = persistent_models;
    let kv = kv_cache_setting(app);
    std::thread::spawn(move || {
        if port_is_open(OLLAMA_ADDR) {
            info!("Ollama already listening on {OLLAMA_ADDR} — reusing it (external/dev)");
            return;
        }
        MANAGED.store(true, Ordering::Relaxed);
        spawn_serve(&bin, &models, &kv);
    });
}

/// Restart the bundled Ollama so a new KV-cache setting takes effect. No-op when
/// CatDesk doesn't manage Ollama (external server — we must not kill it). Returns
/// true when a restart was actually performed.
pub fn restart(app: &AppHandle) -> bool {
    if !is_managed() {
        warn!("restart() ignored — Ollama is external/unmanaged");
        return false;
    }
    let Some(dir) = resource_subdir(app, "ollama") else {
        return false;
    };
    let bin = dir.join("ollama.exe");
    if !bin.exists() {
        return false;
    }
    let models = app
        .path()
        .app_local_data_dir()
        .map(|d| d.join("ollama-models"))
        .unwrap_or_else(|_| dir.join("models"));
    let kv = kv_cache_setting(app);

    stop_managed_ollama();
    // Give the port a moment to free up before re-binding.
    std::thread::sleep(std::time::Duration::from_millis(800));
    spawn_serve(&bin, &models, &kv);
    true
}

/// Arrête l'Ollama lancé par CatDesk AVEC ses runners `llama-server` (sinon ils
/// gardent la VRAM jusqu'au redémarrage). Jamais par nom d'image : l'ancien
/// `taskkill /F /IM ollama.exe` tuait tous les ollama.exe de la machine.
fn stop_managed_ollama() {
    let managed = MANAGED_CHILD
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take();
    if let Some((mut child, tree)) = managed {
        match &tree {
            Some(tree) => tree.kill(),
            None => {
                let _ = child.kill();
            }
        }
        let _ = child.wait();
        info!(
            "Managed Ollama stopped (with its runners: {})",
            tree.is_some()
        );
    }
}

/// À la fermeture de CatDesk (et avant d'installer une mise à jour) : arrête
/// l'Ollama qu'il a lancé. Sans cela il survivait à l'app — et au lancement
/// suivant, CatDesk le prenait pour un Ollama « externe » qu'il ne doit pas
/// toucher : le réglage KV-cache ne pouvait plus s'appliquer.
pub fn shutdown() {
    if is_managed() {
        stop_managed_ollama();
    }
}

/// Move bundled models into the persistent dir on first run. Falls back to a
/// recursive copy if the move fails (e.g. cross-volume).
fn seed_models(bundled: &Path, persistent: &Path) {
    let already_seeded = persistent.join("manifests").exists();
    if already_seeded {
        return;
    }
    if !bundled.join("manifests").exists() {
        // No bundled model (update build, or dev). Nothing to seed — the
        // persistent dir was seeded by a previous full install, or the user
        // pulls models themselves.
        return;
    }

    if let Some(parent) = persistent.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    info!("Seeding Ollama models → {}", persistent.display());
    match std::fs::rename(bundled, persistent) {
        Ok(()) => info!("Models moved into persistent store"),
        Err(e) => {
            warn!("Move failed ({e}); copying instead (slower)");
            if let Err(e) = copy_dir_recursive(bundled, persistent) {
                warn!("Failed to seed models: {e}");
            }
        }
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn spawn_serve(bin: &PathBuf, models: &Path, kv_cache: &str) {
    info!(
        "Starting bundled Ollama: {} (kv_cache={kv_cache})",
        bin.display()
    );

    let mut cmd = std::process::Command::new(bin);
    cmd.arg("serve")
        .env("OLLAMA_HOST", OLLAMA_ADDR)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    // KV-cache quantization (auto-tune): q4_0 frees VRAM so a VRAM-tight model
    // keeps more layers on the GPU. Requires flash attention, so enable it too.
    if kv_cache == "q4_0" {
        cmd.env("OLLAMA_KV_CACHE_TYPE", "q4_0")
            .env("OLLAMA_FLASH_ATTENTION", "1");
    }

    if models.exists() {
        cmd.env("OLLAMA_MODELS", models);
    } else {
        warn!(
            "Ollama models dir missing: {} (models must be pulled)",
            models.display()
        );
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.spawn() {
        Ok(child) => {
            // Rattaché à un arbre tué d'un bloc AVANT que le modèle ne charge :
            // les runners llama-server lancés ensuite y entrent d'office, et
            // un plantage de CatDesk les emporte aussi.
            let tree = ProcessTree::adopt(&child);
            if tree.is_none() {
                warn!("Job Object refusé — un arrêt pourrait laisser des runners Ollama");
            }
            // Gardé pour `shutdown()` / `restart()` : Windows ne tue pas les
            // enfants avec le parent, rien d'autre ne l'arrêterait.
            *MANAGED_CHILD.lock().unwrap_or_else(|e| e.into_inner()) = Some((child, tree));
            info!("Ollama server spawned");
        }
        Err(e) => warn!("Failed to spawn bundled Ollama: {e}"),
    }
}

/// Cheap TCP connect check (no extra deps): is anything accepting on `addr`?
fn port_is_open(addr: &str) -> bool {
    use std::net::TcpStream;
    use std::time::Duration;
    addr.parse()
        .ok()
        .and_then(|sa| TcpStream::connect_timeout(&sa, Duration::from_millis(300)).ok())
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TS_MODELS: &str = include_str!("../../../../../packages/shared-types/src/models.ts");

    /// Les constantes Rust doivent rester alignées sur `@catdesk/shared-types`.
    #[test]
    fn mirror_matches_shared_types_models() {
        assert!(TS_MODELS.contains(&format!("DEFAULT_CHAT_MODEL = '{DEFAULT_CHAT_MODEL}'")));
        assert!(TS_MODELS.contains(&format!("OLLAMA_DEFAULT_URL = '{OLLAMA_URL}'")));
        assert_eq!(OLLAMA_URL, format!("http://{OLLAMA_ADDR}"));
    }
}
