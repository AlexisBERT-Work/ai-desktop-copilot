use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tracing::info;

use crate::core::sandbox;

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
    sandbox::check_path(&args.path)?;

    let max = args.max_bytes.unwrap_or(1_000_000).min(5_000_000);
    let metadata = fs::metadata(&args.path).map_err(|e| e.to_string())?;

    if metadata.len() as usize > max {
        return Err(format!(
            "Fichier trop grand ({} bytes > {} bytes max)",
            metadata.len(),
            max
        ));
    }

    info!(path = %args.path, "Reading file");
    fs::read_to_string(&args.path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn file_write(args: FileWriteArgs) -> Result<(), String> {
    sandbox::check_path(&args.path)?;

    let path = Path::new(&args.path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    info!(path = %args.path, append = args.append.unwrap_or(false), "Writing file");

    if args.append.unwrap_or(false) {
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(&args.path)
            .map_err(|e| e.to_string())?;
        write!(file, "{}", args.content).map_err(|e| e.to_string())
    } else {
        fs::write(&args.path, &args.content).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn dir_list(args: DirListArgs) -> Result<Vec<DirEntry>, String> {
    sandbox::check_path(&args.path)?;

    let include_hidden = args.include_hidden.unwrap_or(false);
    let mut entries = Vec::new();

    let read_dir = fs::read_dir(&args.path).map_err(|e| e.to_string())?;

    for entry in read_dir.take(500) {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();

        if !include_hidden && name.starts_with('.') {
            continue;
        }

        let meta = entry.metadata().ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = meta.as_ref().and_then(|m| if m.is_file() { Some(m.len()) } else { None });
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
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
    });

    Ok(entries)
}
