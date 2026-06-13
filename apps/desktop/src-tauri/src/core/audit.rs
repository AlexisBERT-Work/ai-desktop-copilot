use chrono::Utc;
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

pub fn log_command(command: &str, shell: &str) {
    let entry = format!(
        "{{\"ts\":\"{}\",\"event\":\"COMMAND\",\"shell\":\"{}\",\"cmd\":{}}}\n",
        Utc::now().to_rfc3339(),
        shell,
        serde_json::to_string(command).unwrap_or_default()
    );
    write_log(entry);
}

pub fn log_event(event: &str, data: &str) {
    let entry = format!(
        "{{\"ts\":\"{}\",\"event\":\"{}\",\"data\":{}}}\n",
        Utc::now().to_rfc3339(),
        event,
        data
    );
    write_log(entry);
}

fn write_log(entry: String) {
    let path = audit_log_path();
    if let Ok(mut file) = OpenOptions::new().append(true).create(true).open(path) {
        let _ = file.write_all(entry.as_bytes());
    }
}
