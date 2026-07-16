import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useChatStore } from '../../features/chat/store/chatStore';
import { useOverlayStore } from '../../features/overlay/overlayStore';
import { useSettingsStore } from '../../features/settings/settingsStore';
import {
  useProactiveStore,
  type ProactiveSuggestion,
} from '../../features/proactive/proactiveStore';
import { useMarketStore } from '../../features/market/marketStore';
import type { TokenEvent, DoneEvent, ErrorEvent, MarketSnapshot } from '@catdesk/shared-types';
import { TAURI_EVENTS } from '@catdesk/shared-types';

/**
 * Wires Tauri backend events into Zustand stores.
 * Called once at App root.
 */
export function useTauriEvents() {
  const { appendToken, setPlan, finalizeMessage, setToolActivity, setError } = useChatStore();
  const { toggle } = useOverlayStore();
  const { syncToRuntime } = useSettingsStore();
  const showSuggestion = useProactiveStore(s => s.show);
  const applyMarket = useMarketStore(s => s.apply);

  useEffect(() => {
    // Push persisted settings (e.g. safeMode) to the agent runtime once it's ready
    const syncTimer = setTimeout(() => syncToRuntime(), 3_000);

    const unlisteners: Promise<() => void>[] = [];

    // Global hotkey → toggle overlay
    unlisteners.push(listen(TAURI_EVENTS.uiOverlayToggle, () => toggle()));

    // Token stream
    unlisteners.push(
      listen<TokenEvent>(TAURI_EVENTS.chatToken, e => {
        appendToken(e.payload.conversationId, e.payload.messageId, e.payload.token);
      }),
    );

    // Plan steps (planning enabled)
    unlisteners.push(
      listen<{ conversationId: string; messageId: string; steps: string[] }>(
        TAURI_EVENTS.agentPlan,
        e => {
          setPlan(e.payload.conversationId, e.payload.messageId, e.payload.steps);
        },
      ),
    );

    // Tool activity → drives the "utilise un outil…" status
    unlisteners.push(
      listen<{ type?: string; toolName?: string }>(TAURI_EVENTS.agentToolCall, e => {
        const { type, toolName } = e.payload;
        if (type === 'tool_start') setToolActivity(toolName ?? null);
        else setToolActivity(null); // tool_result / tool_error / tool_blocked → back to thinking
      }),
    );

    // Response complete
    unlisteners.push(
      listen<DoneEvent>(TAURI_EVENTS.chatDone, e => {
        finalizeMessage(e.payload.conversationId, e.payload.messageId);
      }),
    );

    // Error
    unlisteners.push(
      listen<ErrorEvent>(TAURI_EVENTS.chatError, e => {
        setError();
        finalizeMessage(e.payload.conversationId, e.payload.messageId ?? '');
      }),
    );

    // Proactive suggestion (e.g. spiral detection)
    unlisteners.push(
      listen<ProactiveSuggestion>(TAURI_EVENTS.proactiveSuggestion, e => {
        showSuggestion(e.payload);
      }),
    );

    // Live market snapshot (bourse) → marketStore → widget stocks
    unlisteners.push(
      listen<MarketSnapshot>(TAURI_EVENTS.marketUpdate, e => applyMarket(e.payload)),
    );

    return () => {
      clearTimeout(syncTimer);
      unlisteners.forEach(p => p.then(fn => fn()));
    };
  }, [
    appendToken,
    setPlan,
    finalizeMessage,
    setToolActivity,
    setError,
    syncToRuntime,
    showSuggestion,
    applyMarket,
    toggle,
  ]);
}
