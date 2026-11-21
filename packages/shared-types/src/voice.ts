// ─── Voix (mode « Jarvis ») ─────────────────────────────────────
//
// Miroir des types Rust de `core/voice` (sérialisés en camelCase).

/**
 * État de la chaîne voix, tenu côté Rust et publié sur `voice:state`.
 * `dictating` : raccourci de dictée maintenu (le texte ira dans l'application
 * active, pas au modèle).
 */
export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'speaking' | 'dictating';

/** Étape d'une dictée, publiée sur `voice:dictation` (pastille). */
export type VoiceDictationPhase = 'recording' | 'transcribing' | 'done';

/** Issue d'une dictée — miroir de `dictation::Outcome` (vérifié côté Rust). */
export type VoiceDictationOutcome =
  | 'inserted'
  | 'empty'
  | 'focus_changed'
  | 'elevated'
  | 'keys_held'
  | 'blocked'
  | 'no_models'
  | 'mic_error'
  | 'busy';

export interface VoiceDictationEvent {
  phase: VoiceDictationPhase;
  /** Présent quand `phase === 'done'`. */
  outcome?: VoiceDictationOutcome;
  /** Caractères reconnus (tapés si `inserted`) — jamais le texte. */
  chars: number;
}

export interface VoiceConfig {
  /** Dossier Piper, ex. `vits-piper-fr_FR-miro-high`. */
  voice: string;
  /** 0,5 à 2 ; 1 = vitesse nominale. */
  speed: number;
}

/** Réponse de `voice_status`. Un modèle absent n'est pas une erreur : l'UI grise. */
export interface VoiceStatus {
  state: VoiceState;
  sttAvailable: boolean;
  ttsAvailable: boolean;
  modelsDir: string | null;
  voices: string[];
  config: VoiceConfig;
}

/**
 * Vocabulaire personnel de la reconnaissance (`voice_vocabulary_get` / `_set`) :
 * un terme par ligne, « Terme = entendu, entendu » pour les variantes.
 */
export interface VoiceVocabulary {
  text: string;
  /** Fichier sur le disque (`<données>/voice/vocabulaire.txt`). */
  path: string | null;
  terms: number;
  aliases: number;
  /** Lignes ignorées et pourquoi, en français. */
  problems: string[];
}

export interface VoiceStateEvent {
  state: VoiceState;
}

export interface VoiceTranscriptEvent {
  text: string;
  final: boolean;
}

export interface VoiceLevelEvent {
  /** RMS du micro, borné à [0, 1]. */
  rms: number;
}
