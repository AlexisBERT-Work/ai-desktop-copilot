import { invoke } from '@tauri-apps/api/core';

export interface ChatSendPayload {
  conversationId: string;
  message: string;
  messageId: string;
  modelId: string;
  useTools: boolean;
  modelMode?: string | undefined;
  lightModel?: string | undefined;
  codeModel?: string | undefined;
  usePlanning?: boolean | undefined;
}

/**
 * Lance un run agent — les tokens reviennent via les événements
 * TAURI_EVENTS.chatToken/chatDone/chatError. La commande Rust prend un seul
 * paramètre `args: ChatSendArgs`, d'où l'enveloppe sous la clé `args`.
 */
export function chatSend(payload: ChatSendPayload): Promise<void> {
  return invoke('chat_send', { args: payload });
}

/** Interrompt le run en cours (bouton Stop). */
export function chatCancel(): Promise<void> {
  return invoke('chat_cancel');
}
