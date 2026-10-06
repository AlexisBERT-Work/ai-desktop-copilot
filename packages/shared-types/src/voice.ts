// ─── Voix (mode « Jarvis ») ─────────────────────────────────────
//
// Miroir des types Rust de `core/voice` (sérialisés en camelCase).

/** État de la chaîne voix, tenu côté Rust et publié sur `voice:state`. */
export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'speaking';

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
