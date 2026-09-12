import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '../../features/chat/store/chatStore';
import { useOverlayStore } from '../../features/overlay/overlayStore';
import { useSettingsStore } from '../../features/settings/settingsStore';
import {
  useProactiveStore,
  type ProactiveSuggestion,
} from '../../features/proactive/proactiveStore';
import { useMarketStore } from '../../features/market/marketStore';
import { useVoiceStore } from '../../features/voice/voiceStore';
import type {
  TokenEvent,
  DoneEvent,
  ErrorEvent,
  MarketSnapshot,
  VoiceLevelEvent,
  VoiceStateEvent,
  VoiceTranscriptEvent,
} from '@catdesk/shared-types';
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
  // Actions seulement (stables) — `useShallow` évite un objet neuf à chaque rendu.
  const voice = useVoiceStore(
    useShallow(s => ({
      init: s.init,
      onToken: s.onToken,
      onResponseEnd: s.onResponseEnd,
      onTranscript: s.onTranscript,
      onOverlayToggled: s.onOverlayToggled,
      applyState: s.applyState,
      applyLevel: s.applyLevel,
    })),
  );

  useEffect(() => {
    // Push persisted settings (e.g. safeMode) to the agent runtime once it's ready
    const syncTimer = setTimeout(() => syncToRuntime(), 3_000);
    // État des modèles voix + préchauffage (indépendant de l'agent).
    void voice.init();

    const unlisteners: Promise<() => void>[] = [];

    // Global hotkey → toggle overlay (et le micro, si la voix est réglée ainsi)
    unlisteners.push(
      listen(TAURI_EVENTS.uiOverlayToggle, () => {
        toggle();
        voice.onOverlayToggled(useOverlayStore.getState().isVisible);
      }),
    );

    // Token stream — affiché, et découpé en phrases pour la voix
    unlisteners.push(
      listen<TokenEvent>(TAURI_EVENTS.chatToken, e => {
        appendToken(e.payload.conversationId, e.payload.messageId, e.payload.token);
        voice.onToken(e.payload.messageId, e.payload.token);
      }),
    );

    // Voix : état de la chaîne, transcription finale, niveau micro
    unlisteners.push(
      listen<VoiceStateEvent>(TAURI_EVENTS.voiceState, e => voice.applyState(e.payload.state)),
    );
    unlisteners.push(
      listen<VoiceTranscriptEvent>(TAURI_EVENTS.voiceTranscript, e => {
        if (e.payload.final) void voice.onTranscript(e.payload.text);
      }),
    );
    unlisteners.push(
      listen<VoiceLevelEvent>(TAURI_EVENTS.voiceLevel, e => voice.applyLevel(e.payload.rms)),
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
        voice.onResponseEnd();
      }),
    );

    // Error
    unlisteners.push(
      listen<ErrorEvent>(TAURI_EVENTS.chatError, e => {
        setError();
        finalizeMessage(e.payload.conversationId, e.payload.messageId ?? '');
        voice.onResponseEnd();
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
    voice,
  ]);
}
