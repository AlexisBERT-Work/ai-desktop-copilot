import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useChatStore } from '../../features/chat/store/chatStore';
import type { TokenEvent, DoneEvent, ErrorEvent } from '@neurodesk/shared-types';

/**
 * Wires Tauri backend events into Zustand stores.
 * Called once at App root.
 */
export function useTauriEvents() {
  const { appendToken, finalizeMessage } = useChatStore();

  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [];

    // Token stream
    unlisteners.push(
      listen<TokenEvent>('chat:token', e => {
        appendToken(e.payload.conversationId, e.payload.messageId, e.payload.token);
      }),
    );

    // Response complete
    unlisteners.push(
      listen<DoneEvent>('chat:done', e => {
        finalizeMessage(e.payload.conversationId, e.payload.messageId);
      }),
    );

    // Error
    unlisteners.push(
      listen<ErrorEvent>('chat:error', e => {
        finalizeMessage(e.payload.conversationId, e.payload.messageId ?? '');
      }),
    );

    return () => {
      unlisteners.forEach(p => p.then(fn => fn()));
    };
  }, [appendToken, finalizeMessage]);
}
