//! Commandes voix — l'UI ne voit que ça (et les événements `voice:*`).
//!
//! Chaque commande se contente de poster un message aux threads de
//! `core::voice` ; seule `voice_listen_start` attend une réponse, parce que
//! l'UI doit savoir tout de suite si le micro s'est ouvert (modèles absents,
//! micro occupé…) pour afficher pourquoi.

use std::time::Duration;

use serde_json::json;
use tauri::State;
use tokio::sync::oneshot;
use tracing::info;

use crate::core::audit;
use crate::core::error::CatdeskError;
use crate::core::voice::{ListenerCommand, SpeakerCommand, VoiceConfig, VoiceHandle, VoiceStatus};

/// Chargement de Parakeet (~640 Mo int8) compris : au-delà, quelque chose cloche.
const START_TIMEOUT: Duration = Duration::from_secs(20);
/// Une phrase, pas un roman : au-delà, c'est l'UI qui a mal découpé.
const MAX_SENTENCE_CHARS: usize = 1_000;

#[tauri::command]
pub async fn voice_status(voice: State<'_, VoiceHandle>) -> Result<VoiceStatus, String> {
    Ok(voice.status())
}

/// Coupe la parole en cours et ouvre le micro pour un tour.
#[tauri::command]
pub async fn voice_listen_start(voice: State<'_, VoiceHandle>) -> Result<(), String> {
    voice.stop_speaking();
    let (tx, rx) = oneshot::channel();
    voice
        .listener
        .send(ListenerCommand::Start(tx))
        .map_err(|_| CatdeskError::Audio("thread d'écoute arrêté".to_string()))?;
    let outcome = tokio::time::timeout(START_TIMEOUT, rx)
        .await
        .map_err(|_| CatdeskError::Audio("le micro n'a pas répondu à temps".to_string()))?
        .map_err(|_| CatdeskError::Audio("thread d'écoute arrêté".to_string()))?;
    outcome?;
    // Le micro est un effet de bord sensible : chaque ouverture laisse une trace.
    audit::log("VOICE_LISTEN_START", json!({}));
    Ok(())
}

#[tauri::command]
pub async fn voice_listen_stop(voice: State<'_, VoiceHandle>) -> Result<(), String> {
    voice
        .listener
        .send(ListenerCommand::Stop)
        .map_err(|_| CatdeskError::Audio("thread d'écoute arrêté".to_string()))?;
    audit::log("VOICE_LISTEN_STOP", json!({}));
    Ok(())
}

/// Met une phrase dans la file de lecture (l'UI découpe la réponse du modèle).
#[tauri::command]
pub async fn voice_speak(voice: State<'_, VoiceHandle>, text: String) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(());
    }
    if text.chars().count() > MAX_SENTENCE_CHARS {
        return Err(CatdeskError::Refused(format!(
            "Phrase trop longue pour la voix ({} caractères, max {MAX_SENTENCE_CHARS})",
            text.chars().count()
        ))
        .into());
    }
    voice
        .speaker
        .send(SpeakerCommand::Speak(text.to_string()))
        .map_err(|_| CatdeskError::Audio("thread de parole arrêté".to_string()).into())
}

/// Plus rien à dire pour cette réponse (à appeler sur `chat:done` / erreur).
#[tauri::command]
pub async fn voice_speak_end(voice: State<'_, VoiceHandle>) -> Result<(), String> {
    voice
        .speaker
        .send(SpeakerCommand::EndOfTurn)
        .map_err(|_| CatdeskError::Audio("thread de parole arrêté".to_string()).into())
}

#[tauri::command]
pub async fn voice_stop_speaking(voice: State<'_, VoiceHandle>) -> Result<(), String> {
    voice.stop_speaking();
    Ok(())
}

/// Réglages venant de l'UI (voix, vitesse). Le nom de voix est vérifié contre
/// le disque : rien d'inconnu ne descend vers le chargeur de modèles.
#[tauri::command]
pub async fn voice_configure(
    voice: State<'_, VoiceHandle>,
    config: VoiceConfig,
) -> Result<(), String> {
    if !(0.5..=2.0).contains(&config.speed) {
        return Err(
            CatdeskError::Refused("Vitesse de parole hors limites (0,5 à 2)".into()).into(),
        );
    }
    {
        let s = voice.shared.lock().expect("voice shared lock");
        if s.models.piper(&config.voice).is_none() {
            return Err(CatdeskError::Refused(format!(
                "Voix « {} » introuvable dans le dossier des modèles",
                config.voice
            ))
            .into());
        }
    }
    info!(voice = %config.voice, speed = config.speed, "voice_configure");
    voice
        .speaker
        .send(SpeakerCommand::Configure(config))
        .map_err(|_| CatdeskError::Audio("thread de parole arrêté".to_string()).into())
}

/// Précharge VAD + Parakeet + Piper (≈ 3 s) pour que le premier tour soit
/// instantané. À appeler quand l'utilisateur active la voix.
#[tauri::command]
pub async fn voice_warmup(voice: State<'_, VoiceHandle>) -> Result<(), String> {
    let _ = voice.listener.send(ListenerCommand::Warmup);
    let _ = voice.speaker.send(SpeakerCommand::Warmup);
    Ok(())
}
