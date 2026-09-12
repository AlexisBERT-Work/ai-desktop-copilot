//! Voix — écouter l'utilisateur et lui répondre à voix haute (mode « Jarvis »).
//!
//! Tout le temps réel vit ici, en Rust, sur CPU : la RX 6700 n'a pas de
//! CUDA et sa VRAM est déjà prise par `qwen3:14b`. Une seule dépendance
//! d'inférence, `sherpa-onnx`, couvre VAD (Silero), reconnaissance (Parakeet
//! TDT 0.6B v3, WER français 4,97 %) et synthèse (Piper). Le micro et la
//! sortie passent par `cpal`, en natif : ça marche fenêtre cachée, et ça évite
//! `getUserMedia` dans WebView2 (permissions capricieuses, et
//! `SpeechRecognition` n'y fonctionne pas du tout).
//!
//! Deux threads dédiés, parce qu'un flux `cpal` n'est pas `Send` et doit
//! vivre sur le thread qui l'a créé :
//! - [`listener`] : micro → VAD → STT → événement `voice:transcript` ;
//! - [`speaker`] : file de phrases → TTS → haut-parleurs.
//!
//! L'UI ne voit que des commandes (`commands/voice.rs`) et des événements ;
//! elle découpe les réponses du modèle en phrases et les envoie une à une,
//! ce qui permet de parler avant la fin de la génération.

pub mod capture;
pub mod listener;
pub mod machine;
pub mod models;
pub mod playback;
pub mod speaker;
pub mod stt;
pub mod tts;
pub mod vad;

#[cfg(test)]
mod smoke_tests;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use tracing::warn;

use crate::ipc::protocol::EVENT_VOICE_STATE;
pub use machine::VoiceState;

/// Réglages venant de l'UI (persistés côté React, poussés à chaque changement).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceConfig {
    /// Dossier Piper à utiliser, ex. `vits-piper-fr_FR-miro-high`.
    pub voice: String,
    /// Vitesse de parole (1.0 = nominale).
    pub speed: f32,
}

impl Default for VoiceConfig {
    fn default() -> Self {
        Self {
            voice: models::DEFAULT_VOICE.to_string(),
            speed: 1.0,
        }
    }
}

/// Instantané renvoyé par `voice_status` — l'UI s'en sert pour griser le
/// micro et expliquer pourquoi, jamais pour bloquer.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub state: VoiceState,
    /// Modèles de reconnaissance (VAD + Parakeet) trouvés sur le disque.
    pub stt_available: bool,
    /// Modèle Piper de la voix configurée trouvé sur le disque.
    pub tts_available: bool,
    /// Dossier des modèles effectivement utilisé, pour l'afficher dans les réglages.
    pub models_dir: Option<String>,
    /// Voix Piper disponibles (sous-dossiers `vits-piper-*`).
    pub voices: Vec<String>,
    pub config: VoiceConfig,
}

pub enum ListenerCommand {
    /// La réponse dit si le micro a pu s'ouvrir (modèles présents, micro
    /// disponible) — c'est ce que la commande Tauri renvoie à l'UI.
    Start(oneshot::Sender<Result<(), String>>),
    Stop,
    /// Charge les modèles sans écouter, pour que le premier Ctrl+Espace ne
    /// paie pas les ~3 s de chargement de Parakeet.
    Warmup,
}

pub enum SpeakerCommand {
    Speak(String),
    /// Plus aucune phrase ne viendra pour cette réponse : l'état repasse à
    /// `idle` une fois la lecture terminée — et seulement alors. Sans ce
    /// signal, une pause du modèle entre deux phrases ressemblerait à une fin.
    EndOfTurn,
    Stop,
    Configure(VoiceConfig),
    Warmup,
}

/// Ce que les deux threads partagent avec les commandes Tauri.
pub struct Shared {
    pub state: VoiceState,
    pub config: VoiceConfig,
    pub models: models::VoiceModels,
}

/// Poignée stockée dans `tauri::State` : les commandes ne font qu'envoyer des
/// messages, tout le travail est sur les threads dédiés.
pub struct VoiceHandle {
    pub shared: Arc<Mutex<Shared>>,
    pub listener: Sender<ListenerCommand>,
    pub speaker: Sender<SpeakerCommand>,
    /// Levé par les commandes pour couper une synthèse **en cours** sans
    /// attendre que le thread parole lise sa file ; il le rabaisse au `Stop`.
    stop_flag: Arc<AtomicBool>,
}

impl VoiceHandle {
    /// Coupe la parole tout de suite : file vidée, tampon vidé, phrase en
    /// cours abandonnée.
    pub fn stop_speaking(&self) {
        self.stop_flag.store(true, Ordering::SeqCst);
        let _ = self.speaker.send(SpeakerCommand::Stop);
    }

    pub fn status(&self) -> VoiceStatus {
        let s = self.shared.lock().expect("voice shared lock");
        VoiceStatus {
            state: s.state,
            stt_available: s.models.stt().is_some(),
            tts_available: s.models.piper(&s.config.voice).is_some(),
            models_dir: s.models.dir().map(|p| p.display().to_string()),
            voices: s.models.voices(),
            config: s.config.clone(),
        }
    }
}

/// Démarre les deux threads et renvoie la poignée à enregistrer dans Tauri.
/// Ne charge aucun modèle : c'est `Warmup` (ou le premier usage) qui le fait.
pub fn spawn(app: AppHandle) -> VoiceHandle {
    let shared = Arc::new(Mutex::new(Shared {
        state: VoiceState::Idle,
        config: VoiceConfig::default(),
        models: models::VoiceModels::discover(&app),
    }));

    let stop_flag = Arc::new(AtomicBool::new(false));
    let listener = listener::spawn(app.clone(), shared.clone());
    let speaker = speaker::spawn(app, shared.clone(), stop_flag.clone());

    VoiceHandle {
        shared,
        listener,
        speaker,
        stop_flag,
    }
}

/// Change l'état partagé et le publie à l'UI. Les threads ne touchent à
/// l'état que par ici, pour qu'un événement suive toujours un changement.
pub(super) fn set_state(app: &AppHandle, shared: &Arc<Mutex<Shared>>, state: VoiceState) {
    {
        let mut s = shared.lock().expect("voice shared lock");
        if s.state == state {
            return;
        }
        s.state = state;
    }
    if let Err(e) = app.emit(EVENT_VOICE_STATE, serde_json::json!({ "state": state })) {
        warn!("voice: impossible d'émettre l'état ({e})");
    }
}
