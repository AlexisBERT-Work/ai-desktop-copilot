import { invoke } from '@tauri-apps/api/core';
import type { VoiceConfig, VoiceStatus } from '@catdesk/shared-types';

/** État des modèles et de la chaîne voix (commande `voice_status`). */
export function voiceStatus(): Promise<VoiceStatus> {
  return invoke('voice_status');
}

/**
 * Coupe la parole en cours et ouvre le micro pour un tour. Rejette (message
 * en français) si les modèles manquent ou si le micro est indisponible.
 */
export function voiceListenStart(): Promise<void> {
  return invoke('voice_listen_start');
}

export function voiceListenStop(): Promise<void> {
  return invoke('voice_listen_stop');
}

/** Met une phrase dans la file de lecture. */
export function voiceSpeak(text: string): Promise<void> {
  return invoke('voice_speak', { text });
}

/** Plus rien à dire pour cette réponse : l'état repassera à `idle` après lecture. */
export function voiceSpeakEnd(): Promise<void> {
  return invoke('voice_speak_end');
}

export function voiceStopSpeaking(): Promise<void> {
  return invoke('voice_stop_speaking');
}

export function voiceConfigure(config: VoiceConfig): Promise<void> {
  return invoke('voice_configure', { config });
}

/** Précharge VAD + Parakeet + Piper pour que le premier tour soit instantané. */
export function voiceWarmup(): Promise<void> {
  return invoke('voice_warmup');
}
