import { invoke } from '@tauri-apps/api/core';
import type { VoiceConfig, VoiceStatus, VoiceVocabulary } from '@catdesk/shared-types';

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

/**
 * Active ou coupe la dictée (Ctrl+Alt+Espace maintenu : le texte s'écrit dans
 * l'application active). Rejette si les modèles manquent ou si le raccourci
 * est déjà pris par une autre application.
 */
export function voiceSetDictation(enabled: boolean): Promise<void> {
  return invoke('voice_set_dictation', { enabled });
}

/** Vocabulaire personnel de la reconnaissance vocale (noms propres, applis…). */
export function voiceVocabularyGet(): Promise<VoiceVocabulary> {
  return invoke('voice_vocabulary_get');
}

/**
 * Enregistre le vocabulaire et le met en service tout de suite. Rejette
 * (message en français) s'il est trop long ou contient des caractères de contrôle.
 */
export function voiceVocabularySet(text: string): Promise<VoiceVocabulary> {
  return invoke('voice_vocabulary_set', { text });
}

/** Coupe ou rétablit la correction des noms propres, sans toucher au fichier. */
export function voiceSetVocabularyEnabled(enabled: boolean): Promise<void> {
  return invoke('voice_set_vocabulary_enabled', { enabled });
}
