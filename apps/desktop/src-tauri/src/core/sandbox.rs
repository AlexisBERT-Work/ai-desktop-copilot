use anyhow::{bail, Result};

/// Patterns that are always blocked regardless of permission level
const BLOCKED_COMMAND_PATTERNS: &[&str] = &[
    "rm -rf /",
    "format c:",
    "del /s /f /q c:\\",
    "rd /s /q c:\\",
    "shutdown /",
    "reg delete hklm",
    "bcdedit",
    "diskpart",
    "net user administrator",
    "powershell -enc",       // Encoded payloads
    "invoke-expression",     // Alias iex
    "downloadstring",        // Web download + exec pattern
    "bypass",                // ExecutionPolicy bypass
];

const MAX_COMMAND_LEN: usize = 2048;

/// Check a command string against the safety blocklist.
pub fn check_command(command: &str) -> Result<()> {
    if command.len() > MAX_COMMAND_LEN {
        bail!("Commande trop longue ({} chars > {} max)", command.len(), MAX_COMMAND_LEN);
    }

    let lower = command.to_lowercase();
    for pattern in BLOCKED_COMMAND_PATTERNS {
        if lower.contains(pattern) {
            bail!("Commande bloquée par politique de sécurité (pattern: '{pattern}')");
        }
    }

    Ok(())
}

/// Allowed filesystem root paths (expandable in settings).
/// For MVP: only user home directories.
pub fn check_path(path: &str) -> Result<()> {
    let normalized = path.replace('\\', "/").to_lowercase();

    // Prevent path traversal
    if normalized.contains("../") || normalized.contains("..\\") {
        bail!("Chemin non autorisé: traversal détecté");
    }

    let user_profile = std::env::var("USERPROFILE")
        .unwrap_or_default()
        .replace('\\', "/")
        .to_lowercase();

    let temp = std::env::temp_dir()
        .to_string_lossy()
        .replace('\\', "/")
        .to_lowercase();

    let allowed = [
        user_profile.as_str(),
        temp.as_str(),
    ];

    if !allowed.iter().any(|a| !a.is_empty() && normalized.starts_with(a)) {
        bail!("Chemin non autorisé: {path}. Seuls les dossiers utilisateur et temp sont accessibles.");
    }

    Ok(())
}
