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
import { useSelectionStore } from '../../features/selection/selectionStore';
import type {
  TokenEvent,
  DoneEvent,
  ErrorEvent,
  MarketSnapshot,
  SelectionEvent,
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
  const appendToken = useChatStore(s => s.appendToken);
  const setPlan = useChatStore(s => s.setPlan);
  const finalizeMessage = useChatStore(s => s.finalizeMessage);
  const setToolActivity = useChatStore(s => s.setToolActivity);
  const setError = useChatStore(s => s.setError);
  const toggle = useOverlayStore(s => s.toggle);
  const syncToRuntime = useSettingsStore(s => s.syncToRuntime);
  const syncSelectionHotkey = useSettingsStore(s => s.syncSelectionHotkey);
  const applySelection = useSelectionStore(s => s.apply);
  const cancelSelection = useSelectionStore(s => s.cancel);
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
    // Réglages persistés (safe mode) → runtime. Tout de suite : le cœur les
    // mémorise et les rejoue à chaque (re)démarrage de l'agent — plus besoin
    // d'attendre « que l'agent soit prêt » (l'ancien délai de 3 s ratait un
    // agent lent à démarrer, qui tournait alors sans safe mode).
    syncToRuntime();
    // État des modèles voix + préchauffage (indépendant de l'agent).
    void voice.init();
    // Raccourci Ctrl+Alt+T, s'il a été activé (le cœur ne le retient pas).
    void syncSelectionHotkey();

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

    // Texte sélectionné (Ctrl+Alt+T) : la bulle s'ouvre sur la consigne, puis
    // sur l'avant/après — ou dit pourquoi rien n'a été copié.
    unlisteners.push(
      listen<SelectionEvent>(TAURI_EVENTS.selectionUpdate, e => {
        if (applySelection(e.payload)) useOverlayStore.getState().show('selection');
      }),
    );
    // Refermer la bulle (Échap, Ctrl+Espace, ✕) abandonne la sélection en attente.
    const unsubscribeOverlay = useOverlayStore.subscribe((state, prev) => {
      if (prev.mode === 'selection' && state.mode !== 'selection') cancelSelection();
    });

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
      unsubscribeOverlay();
      unlisteners.forEach(p => p.then(fn => fn()));
    };
  }, [
    appendToken,
    setPlan,
    finalizeMessage,
    setToolActivity,
    setError,
    syncToRuntime,
    syncSelectionHotkey,
    applySelection,
    cancelSelection,
    showSuggestion,
    applyMarket,
    toggle,
    voice,
  ]);
}
