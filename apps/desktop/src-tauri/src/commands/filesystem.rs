use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::Path;
use tracing::info;

use crate::core::{audit, sandbox};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReadArgs {
    pub path: String,
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteArgs {
    pub path: String,
    pub content: String,
    pub append: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListArgs {
    pub path: String,
    pub recursive: Option<bool>,
    pub include_hidden: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub extension: Option<String>,
}

#[tauri::command]
pub async fn file_read(args: FileReadArgs) -> Result<String, String> {
    // On travaille ensuite sur le chemin canonique retourné par la sandbox,
    // jamais sur la chaîne fournie (symlinks/casse résolus une seule fois).
    let path = sandbox::check_path(&args.path).map_err(|e| e.to_string())?;

    let max = args.max_bytes.unwrap_or(1_000_000).min(5_000_000);
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;

    if metadata.len() as usize > max {
        return Err(format!(
            "Fichier trop grand ({} bytes > {} bytes max)",
            metadata.len(),
            max
        ));
    }

    info!(path = %path.display(), "Reading file");
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn file_write(args: FileWriteArgs) -> Result<(), String> {
    let path = sandbox::check_path(&args.path).map_err(|e| e.to_string())?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let append = args.append.unwrap_or(false);
    info!(path = %path.display(), append, "Writing file");

    if append {
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        write!(file, "{}", args.content).map_err(|e| e.to_string())?;
    } else {
        fs::write(&path, &args.content).map_err(|e| e.to_string())?;
    }

    audit::log(
        "FILE_WRITE",
        json!({
            "path": path.display().to_string(),
            "bytes": args.content.len(),
            "append": append,
        }),
    );
    Ok(())
}

#[tauri::command]
pub async fn dir_list(args: DirListArgs) -> Result<Vec<DirEntry>, String> {
    let path = sandbox::check_path(&args.path).map_err(|e| e.to_string())?;

    let include_hidden = args.include_hidden.unwrap_or(false);
    let mut entries = Vec::new();

    let read_dir = fs::read_dir(&path).map_err(|e| e.to_string())?;

    for entry in read_dir.take(500) {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();

        if !include_hidden && name.starts_with('.') {
            continue;
        }

        let meta = entry.metadata().ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = meta
            .as_ref()
            .and_then(|m| if m.is_file() { Some(m.len()) } else { None });
        let extension = if !is_dir {
            Path::new(&name)
                .extension()
                .map(|e| e.to_string_lossy().to_string())
        } else {
            None
        };

        entries.push(DirEntry {
            path: entry.path().to_string_lossy().to_string(),
            name,
            is_dir,
            size,
            extension,
        });
    }

    // Directories first, then files, both alphabetical
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));

    Ok(entries)
}
