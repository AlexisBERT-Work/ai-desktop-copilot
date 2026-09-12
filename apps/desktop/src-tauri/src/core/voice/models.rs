//! Où sont les modèles voix, et lesquels sont là.
//!
//! Quatre emplacements sondés dans l'ordre, le premier qui existe gagne :
//! 1. la ressource empaquetée `voice/` (installeur hors-ligne, cf.
//!    `tauri.release.conf.json` et `catdesk.iss`) ;
//! 2. `src-tauri/resources/voice/` (dossier ignoré par git, effacé par
//!    `build-release.ps1`) ;
//! 3. `%LOCALAPPDATA%/nd-voice-models/` — le cache rempli par
//!    `scripts/fetch-voice-models.ps1`, ce qui sert en dev ;
//! 4. `%APPDATA%/CatDesk/data/voice/` — pour déposer des modèles sans
//!    réinstaller (ou après une mise à jour qui n'en embarque pas).
//!
//! Aucun modèle absent n'est une erreur : `voice_status` le dit à l'UI, qui
//! grise le micro et se rabat sur la voix Windows pour lire les réponses.

use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tracing::info;

use crate::core::resources::resource_subdir;

pub const DEFAULT_VOICE: &str = "vits-piper-fr_FR-miro-high";
const PARAKEET_DIR: &str = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8";
const SILERO_FILE: &str = "silero_vad.onnx";

/// Fichiers de la reconnaissance : VAD + Parakeet (encodeur/décodeur/joiner + tokens).
#[derive(Clone, Debug)]
pub struct SttPaths {
    pub vad: PathBuf,
    pub encoder: PathBuf,
    pub decoder: PathBuf,
    pub joiner: PathBuf,
    pub tokens: PathBuf,
}

/// Fichiers d'une voix Piper (VITS + données espeak-ng pour la phonémisation).
#[derive(Clone, Debug)]
pub struct PiperPaths {
    pub model: PathBuf,
    pub tokens: PathBuf,
    pub espeak_data: PathBuf,
}

#[derive(Clone, Debug, Default)]
pub struct VoiceModels {
    dir: Option<PathBuf>,
}

impl VoiceModels {
    pub fn discover(app: &AppHandle) -> Self {
        let dir = Self::first_existing(resource_subdir(app, "voice"));
        match &dir {
            Some(d) => info!("voice: modèles dans {}", d.display()),
            None => info!("voice: aucun dossier de modèles — voix désactivée"),
        }
        Self { dir }
    }

    /// Même résolution que [`Self::discover`], sans ressource empaquetée —
    /// pour les tests de fumée, qui n'ont pas d'`AppHandle`.
    #[cfg(test)]
    pub fn discover_local() -> Self {
        Self {
            dir: Self::first_existing(None),
        }
    }

    fn first_existing(bundled: Option<PathBuf>) -> Option<PathBuf> {
        let dev_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("voice");
        let cache_dir = std::env::var("LOCALAPPDATA")
            .ok()
            .map(|p| PathBuf::from(p).join("nd-voice-models"));
        let user_dir = std::env::var("APPDATA")
            .ok()
            .map(|p| PathBuf::from(p).join("CatDesk").join("data").join("voice"));

        bundled
            .into_iter()
            .chain(std::iter::once(dev_dir))
            .chain(cache_dir)
            .chain(user_dir)
            .find(|p| p.is_dir())
    }

    #[cfg(test)]
    pub fn at(dir: PathBuf) -> Self {
        Self { dir: Some(dir) }
    }

    pub fn dir(&self) -> Option<&Path> {
        self.dir.as_deref()
    }

    /// `Some` seulement si VAD **et** les quatre fichiers Parakeet sont là.
    pub fn stt(&self) -> Option<SttPaths> {
        let dir = self.dir.as_ref()?;
        let p = dir.join(PARAKEET_DIR);
        let paths = SttPaths {
            vad: dir.join(SILERO_FILE),
            encoder: p.join("encoder.int8.onnx"),
            decoder: p.join("decoder.int8.onnx"),
            joiner: p.join("joiner.int8.onnx"),
            tokens: p.join("tokens.txt"),
        };
        [
            &paths.vad,
            &paths.encoder,
            &paths.decoder,
            &paths.joiner,
            &paths.tokens,
        ]
        .iter()
        .all(|f| f.is_file())
        .then_some(paths)
    }

    /// La voix Piper `voice` (nom du sous-dossier, ex. `vits-piper-fr_FR-miro-high`).
    /// Le fichier `.onnx` porte le nom du dossier sans le préfixe `vits-piper-`.
    pub fn piper(&self, voice: &str) -> Option<PiperPaths> {
        // Un nom de voix vient de l'UI : on refuse tout ce qui ressemble à un
        // chemin pour ne jamais sortir du dossier des modèles.
        if voice.is_empty() || voice.contains(['/', '\\', '.']) {
            return None;
        }
        let dir = self.dir.as_ref()?.join(voice);
        let stem = voice.strip_prefix("vits-piper-").unwrap_or(voice);
        let paths = PiperPaths {
            model: dir.join(format!("{stem}.onnx")),
            tokens: dir.join("tokens.txt"),
            espeak_data: dir.join("espeak-ng-data"),
        };
        (paths.model.is_file() && paths.tokens.is_file() && paths.espeak_data.is_dir())
            .then_some(paths)
    }

    /// Sous-dossiers `vits-piper-*` complets, triés — la liste des réglages.
    pub fn voices(&self) -> Vec<String> {
        let Some(dir) = &self.dir else {
            return vec![];
        };
        let Ok(entries) = std::fs::read_dir(dir) else {
            return vec![];
        };
        let mut voices: Vec<String> = entries
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|name| name.starts_with("vits-piper-") && self.piper(name).is_some())
            .collect();
        voices.sort();
        voices
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("catdesk-voice-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch(p: &Path) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, b"x").unwrap();
    }

    #[test]
    fn stt_exige_tous_les_fichiers() {
        let dir = scratch("stt");
        let m = VoiceModels::at(dir.clone());
        assert!(m.stt().is_none());

        touch(&dir.join(SILERO_FILE));
        let p = dir.join(PARAKEET_DIR);
        for f in ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx"] {
            touch(&p.join(f));
        }
        assert!(m.stt().is_none(), "tokens.txt manque encore");
        touch(&p.join("tokens.txt"));
        assert!(m.stt().is_some());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn piper_refuse_les_chemins_et_liste_les_voix_completes() {
        let dir = scratch("piper");
        let m = VoiceModels::at(dir.clone());

        let v = dir.join("vits-piper-fr_FR-miro-high");
        touch(&v.join("fr_FR-miro-high.onnx"));
        touch(&v.join("tokens.txt"));
        fs::create_dir_all(v.join("espeak-ng-data")).unwrap();
        // Une voix incomplète (pas d'espeak) ne doit pas être listée.
        touch(
            &dir.join("vits-piper-fr_FR-siwis-medium")
                .join("fr_FR-siwis-medium.onnx"),
        );

        assert!(m.piper("vits-piper-fr_FR-miro-high").is_some());
        assert!(m.piper("vits-piper-fr_FR-siwis-medium").is_none());
        assert!(m.piper("../vits-piper-fr_FR-miro-high").is_none());
        assert!(m.piper("").is_none());
        assert_eq!(m.voices(), vec!["vits-piper-fr_FR-miro-high".to_string()]);
        let _ = fs::remove_dir_all(&dir);
    }
}
