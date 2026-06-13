import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useChatStore } from '../../features/chat/store/chatStore';
import { useOverlayStore } from '../../features/overlay/overlayStore';
import { useSettingsStore } from '../../features/settings/settingsStore';
import { useProactiveStore, type ProactiveSuggestion } from '../../features/proactive/proactiveStore';
import type { TokenEvent, DoneEvent, ErrorEvent } from '@catdesk/shared-types';

/**
 * Wires Tauri backend events into Zustand stores.
 * Called once at App root.
 */
export function useTauriEvents() {
  const { appendToken, setPlan, finalizeMessage } = useChatStore();
  const { toggle } = useOverlayStore();
  const { syncToRuntime } = useSettingsStore();
  const showSuggestion = useProactiveStore(s => s.show);

  useEffect(() => {
    // Push persisted settings (e.g. safeMode) to the agent runtime once it's ready
    const syncTimer = setTimeout(() => syncToRuntime(), 3_000);

    const unlisteners: Promise<() => void>[] = [];

    // Global hotkey → toggle overlay
    unlisteners.push(
      listen('ui:overlay-toggle', () => toggle()),
    );

    // Token stream
    unlisteners.push(
      listen<TokenEvent>('chat:token', e => {
        appendToken(e.payload.conversationId, e.payload.messageId, e.payload.token);
      }),
    );

    // Plan steps (planning enabled)
    unlisteners.push(
      listen<{ conversationId: string; messageId: string; steps: string[] }>('agent:plan', e => {
        setPlan(e.payload.conversationId, e.payload.messageId, e.payload.steps);
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

    // Proactive suggestion (e.g. spiral detection)
    unlisteners.push(
      listen<ProactiveSuggestion>('proactive:suggestion', e => {
        showSuggestion(e.payload);
      }),
    );

    return () => {
      clearTimeout(syncTimer);
      unlisteners.forEach(p => p.then(fn => fn()));
    };
  }, [appendToken, setPlan, finalizeMessage, syncToRuntime, showSuggestion]);
}
