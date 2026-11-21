//! Commandes « transformer le texte sélectionné » — voir `core::selection`.
//!
//! L'UI ne manipule jamais le texte à coller : elle donne une consigne
//! (`selection_transform`), puis dit « colle » (`selection_replace`) ou
//! « laisse tomber » (`selection_cancel`). Le texte d'origine et le résultat
//! restent dans le cœur.

use std::time::Instant;

use serde_json::json;
use tauri::{AppHandle, State};
use tracing::info;

use crate::commands::forward_to_agent;
use crate::core::audit;
use crate::core::error::CatdeskError;
use crate::core::hotkeys;
use crate::core::selection::{self, Outcome, SelectionState, MAX_INSTRUCTION_CHARS};
use crate::ipc::protocol;

/// Modèle demandé par l'UI : un nom Ollama, pas un roman.
const MAX_MODEL_CHARS: usize = 200;

/// Active ou retire le raccourci `Ctrl+Alt+T`. Un raccourci déjà pris par
/// une autre application est renvoyé tel quel à l'UI, qui recoche « off ».
#[tauri::command]
pub async fn selection_set_enabled(
    app: AppHandle,
    state: State<'_, SelectionState>,
    enabled: bool,
) -> Result<(), String> {
    let changed = hotkeys::set_selection_hotkey(&app, enabled)?;
    if !enabled {
        state.clear();
    }
    // Un raccourci global qui envoie Ctrl+C ailleurs : son activation laisse une trace.
    if changed {
        audit::log("SELECTION_SETTING", json!({ "enabled": enabled }));
    }
    Ok(())
}

/// Consigne et modèle nettoyés, ou refus en français. Pur.
fn validate(instruction: &str, model: &str) -> Result<(String, String), CatdeskError> {
    let instruction = instruction.trim();
    if instruction.is_empty() {
        return Err(CatdeskError::Refused(
            "Donnez une consigne (corrige, traduis…)".into(),
        ));
    }
    if instruction.chars().count() > MAX_INSTRUCTION_CHARS {
        return Err(CatdeskError::Refused(format!(
            "Consigne trop longue (au plus {MAX_INSTRUCTION_CHARS} caractères)"
        )));
    }
    let model = model.trim();
    if model.is_empty() || model.chars().count() > MAX_MODEL_CHARS {
        return Err(CatdeskError::Refused("Modèle invalide".into()));
    }
    Ok((instruction.to_string(), model.to_string()))
}

/// Envoie la sélection en attente à l'agent avec la consigne. Le résultat
/// revient par `selection:update` (`phase: "result"`).
#[tauri::command]
pub async fn selection_transform(
    state: State<'_, SelectionState>,
    instruction: String,
    model: String,
) -> Result<(), String> {
    let (instruction, model) = validate(&instruction, &model)?;
    let (request_id, text) = state.begin_transform(Instant::now()).map_err(|_| {
        CatdeskError::Refused("Plus de sélection en attente : refaites Ctrl+Alt+T".into())
    })?;
    info!(chars = text.chars().count(), "selection_transform");
    let sent = forward_to_agent(
        protocol::RPC_SELECTION_TRANSFORM,
        json!({
            "requestId": request_id,
            "text": text,
            "instruction": instruction,
            "model": model,
        }),
    )
    .await;
    if sent.is_err() {
        state.transform_failed(&request_id);
    }
    sent
}

/// Colle le résultat validé à la place de la sélection, dans la fenêtre
/// d'origine. Renvoie l'issue (`replaced` ou la raison du refus).
#[tauri::command]
pub async fn selection_replace(state: State<'_, SelectionState>) -> Result<Outcome, String> {
    let job = match state.paste_job(Instant::now()) {
        Ok(job) => job,
        Err(outcome) => return Ok(outcome),
    };
    let target = job.target;
    let text = job.text.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || selection::paste(target, &text))
        .await
        .map_err(|e| CatdeskError::Refused(format!("Collage interrompu ({e})")))?;
    if outcome == Outcome::Replaced {
        state.clear();
        // Ctrl+V envoyé à une autre application : une trace, sans le texte.
        audit::log(
            "SELECTION_REPLACE",
            json!({
                "charsIn": job.original_chars,
                "charsOut": job.text.chars().count(),
            }),
        );
    }
    info!(outcome = outcome.as_str(), "selection_replace");
    Ok(outcome)
}

/// Abandonne la sélection en attente (Échap dans la bulle) et interrompt la
/// transformation si elle tourne encore.
#[tauri::command]
pub async fn selection_cancel(state: State<'_, SelectionState>) -> Result<(), String> {
    if state.clear() {
        forward_to_agent(protocol::RPC_SELECTION_CANCEL, json!({})).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_consigne_est_nettoyee_et_bornee() {
        let (instruction, model) = validate("  corrige \n", " qwen3:14b ").unwrap();
        assert_eq!(instruction, "corrige");
        assert_eq!(model, "qwen3:14b");
        assert!(validate(" ", "qwen3:14b").is_err());
        assert!(validate(&"x".repeat(MAX_INSTRUCTION_CHARS + 1), "qwen3:14b").is_err());
        assert!(validate(&"é".repeat(MAX_INSTRUCTION_CHARS), "qwen3:14b").is_ok());
        assert!(validate("corrige", "").is_err());
        let err: String = validate("", "m").unwrap_err().into();
        assert_eq!(err, "Donnez une consigne (corrige, traduis…)");
    }
}
