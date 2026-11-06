import { invoke } from '@tauri-apps/api/core';
import type { ChatSendPayload } from '@catdesk/shared-types';

/**
 * Lance un run agent — les tokens reviennent via les événements
 * TAURI_EVENTS.chatToken/chatDone/chatError. La commande Rust prend un seul
 * paramètre `args: ChatSendArgs`, d'où l'enveloppe sous la clé `args`.
 */
export function chatSend(payload: ChatSendPayload): Promise<void> {
  return invoke('chat_send', { args: payload });
}

/**
 * Préchauffe le modèle (ouverture du chat, début de saisie) : l'agent le charge
 * et lit le début des requêtes — dont l'historique de `conversationId` —
 * pendant que l'utilisateur tape.
 */
export function chatWarmup(model: string, conversationId?: string): Promise<void> {
  return invoke('chat_warmup', { model, conversationId });
}

/** Interrompt le run en cours (bouton Stop). */
export function chatCancel(): Promise<void> {
  return invoke('chat_cancel');
}
