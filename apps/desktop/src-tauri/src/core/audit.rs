use chrono::Utc;
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

fn audit_log_path() -> PathBuf {
    let date = Utc::now().format("%Y-%m-%d").to_string();
    let data_dir = dirs_next();
    data_dir.join(format!("audit-{date}.log"))
}

fn dirs_next() -> PathBuf {
    let base = std::env::var("CATDESK_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("APPDATA")
                .map(|p| PathBuf::from(p).join("CatDesk").join("data"))
                .unwrap_or_else(|_| PathBuf::from("data"))
        });

    let audit = base.join("audit");
    let _ = fs::create_dir_all(&audit);
    audit
}

/// Trace d'audit générique : une ligne JSON `{ts, event, ...data}` par
/// événement — même forme que l'AuditLogger du sidecar Node, pour un log
/// combiné uniforme. Best-effort : ne bloque jamais l'opération auditée.
/// À appeler APRÈS le succès de tout side-effect (règle projet).
pub fn log(event: &str, data: Value) {
    let mut entry = json!({
        "ts": Utc::now().to_rfc3339(),
        "event": event,
    });
    if let (Some(obj), Some(extra)) = (entry.as_object_mut(), data.as_object()) {
        for (k, v) in extra {
            obj.insert(k.clone(), v.clone());
        }
    }
    write_log(format!("{entry}\n"));
}

pub fn log_command(command: &str, shell: &str) {
    log("COMMAND", json!({ "shell": shell, "cmd": command }));
}

fn write_log(entry: String) {
    let path = audit_log_path();
    if let Ok(mut file) = OpenOptions::new().append(true).create(true).open(path) {
        let _ = file.write_all(entry.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // dirs_next lit CATDESK_DATA_DIR : on sérialise les tests qui mutent l'env.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn log_writes_parsable_json_lines() {
        let _g = ENV_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("catdesk-audit-test-{}", std::process::id()));
        std::env::set_var("CATDESK_DATA_DIR", &dir);

        log(
            "FILE_WRITE",
            json!({ "path": "C:\\tmp\\x.txt", "bytes": 42, "append": false }),
        );
        log_command("git status \"avec quotes\"", "powershell");

        let content = fs::read_to_string(audit_log_path()).expect("log lisible");
        std::env::remove_var("CATDESK_DATA_DIR");
        let _ = fs::remove_dir_all(&dir);

        let lines: Vec<&str> = content.lines().collect();
        assert!(lines.len() >= 2);
        for line in &lines {
            let v: Value = serde_json::from_str(line).expect("chaque ligne est du JSON");
            assert!(v.get("ts").is_some());
            assert!(v.get("event").is_some());
        }
        // log_command garde sa forme historique à plat {ts, event, shell, cmd}.
        let last: Value = serde_json::from_str(lines.last().unwrap()).unwrap();
        assert_eq!(last["event"], "COMMAND");
        assert_eq!(last["shell"], "powershell");
        assert_eq!(last["cmd"], "git status \"avec quotes\"");
    }
}
