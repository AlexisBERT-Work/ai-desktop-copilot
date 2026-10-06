import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VoiceState, VoiceStatus } from '@catdesk/shared-types';
import {
  voiceConfigure,
  voiceListenStart,
  voiceListenStop,
  voiceSpeak,
  voiceSpeakEnd,
  voiceStatus,
  voiceStopSpeaking,
  voiceWarmup,
} from '../../shared/api/voice';
import { useChatStore } from '../chat/store/chatStore';
import { useOverlayStore } from '../overlay/overlayStore';
import { createSentenceChunker } from './sentenceChunker';
import { createWindowsSpeech } from './windowsSpeech';

/**
 * Chef d'orchestre de la voix côté React.
 *
 * Le temps réel (micro, VAD, reconnaissance, synthèse) est en Rust ; ici on
 * décide QUAND écouter, on transforme une transcription en message, on
 * découpe les réponses en phrases et on les envoie à la synthèse — native
 * (Piper) si ses modèles sont là, voix Windows sinon.
 *
 * Réglages persistés (`catdesk-voice`) ; l'état temps réel ne l'est pas.
 */

const TEST_SENTENCE =
  'Bonjour, je suis CatDesk. Il est possible de me parler avec Contrôle Espace.';

interface VoiceSettings {
  /** Interrupteur général : sans lui, rien n'écoute ni ne parle. */
  enabled: boolean;
  /** Lire les réponses à voix haute. */
  readAloud: boolean;
  /** Ctrl+Espace ouvre la bulle ET le micro. */
  autoListenOnOverlay: boolean;
  /** Après une réponse à une question orale, réécouter sans raccourci. */
  continueAfterAnswer: boolean;
  voice: string;
  speed: number;
}

interface VoiceRuntime {
  state: VoiceState;
  /** Niveau micro [0, 1], pour le halo du bouton. */
  level: number;
  /** `null` tant que `voice_status` n'a pas répondu. */
  status: VoiceStatus | null;
  /** Message court pour l'utilisateur (« Je n'ai rien entendu »). */
  hint: string | null;
  /** Le dernier message envoyé venait du micro → réécoute possible après réponse. */
  lastInputWasVoice: boolean;
}

interface VoiceActions {
  /** Au démarrage : état des modèles, réglages poussés à Rust, préchauffage. */
  init: () => Promise<void>;
  listen: () => Promise<void>;
  stopListening: () => Promise<void>;
  stopSpeaking: () => Promise<void>;
  toggleListening: () => Promise<void>;
  /** Transcription finale reçue de Rust. */
  onTranscript: (text: string) => Promise<void>;
  /** Flux de la réponse : tokens, fin, erreur. */
  onToken: (messageId: string, token: string) => void;
  onResponseEnd: () => void;
  /** Ctrl+Espace : la bulle vient de s'ouvrir ou de se fermer. */
  onOverlayToggled: (visible: boolean) => void;
  applyState: (state: VoiceState) => void;
  applyLevel: (rms: number) => void;
  testVoice: () => void;
  setEnabled: (enabled: boolean) => void;
  setReadAloud: (on: boolean) => void;
  setAutoListenOnOverlay: (on: boolean) => void;
  setContinueAfterAnswer: (on: boolean) => void;
  setVoice: (voice: string) => void;
  setSpeed: (speed: number) => void;
}

type VoiceStore = VoiceSettings & VoiceRuntime & VoiceActions;

const DEFAULT_VOICE = 'vits-piper-fr_FR-miro-high';

// Découpeur et voix de secours : un seul exemplaire, hors état React.
let chunker = createSentenceChunker();
let currentMessageId: string | null = null;
let windowsSpeech: ReturnType<typeof createWindowsSpeech> | null = null;

function fallback() {
  windowsSpeech ??= createWindowsSpeech(state => {
    // La voix Windows n'a pas d'état côté Rust : on le simule ici.
    if (!useVoiceStore.getState().status?.ttsAvailable) useVoiceStore.getState().applyState(state);
  });
  return windowsSpeech;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const useVoiceStore = create<VoiceStore>()(
  persist(
    (set, get) => ({
      enabled: true,
      readAloud: true,
      autoListenOnOverlay: true,
      continueAfterAnswer: false,
      voice: DEFAULT_VOICE,
      speed: 1,

      state: 'idle',
      level: 0,
      status: null,
      hint: null,
      lastInputWasVoice: false,

      init: async () => {
        try {
          const status = await voiceStatus();
          set({ status, state: status.state });
          const { enabled, voice, speed } = get();
          // Une voix persistée qui n'existe plus sur le disque → celle par défaut.
          const wanted = status.voices.includes(voice) ? voice : (status.voices[0] ?? voice);
          if (wanted !== voice) set({ voice: wanted });
          if (status.voices.includes(wanted)) {
            await voiceConfigure({ voice: wanted, speed }).catch(() => {});
          }
          if (enabled && (status.sttAvailable || status.ttsAvailable)) {
            await voiceWarmup().catch(() => {});
          }
        } catch (err) {
          set({ hint: message(err) });
        }
      },

      listen: async () => {
        const { enabled, status } = get();
        if (!enabled) return;
        if (!status?.sttAvailable) {
          set({ hint: 'Modèles de reconnaissance absents — voir Paramètres › Voix.' });
          return;
        }
        fallback().cancel();
        try {
          set({ hint: null });
          await voiceListenStart();
        } catch (err) {
          set({ hint: message(err), state: 'idle' });
        }
      },

      stopListening: async () => {
        if (get().state !== 'listening') return;
        await voiceListenStop().catch(() => {});
      },

      stopSpeaking: async () => {
        chunker.reset();
        fallback().cancel();
        await voiceStopSpeaking().catch(() => {});
      },

      toggleListening: async () => {
        const { state, listen, stopListening, stopSpeaking } = get();
        if (state === 'listening') return stopListening();
        if (state === 'speaking') return stopSpeaking();
        return listen();
      },

      onTranscript: async text => {
        const clean = text.trim();
        if (!clean) {
          set({ hint: "Je n'ai rien compris — réessaie." });
          return;
        }
        set({ hint: null, lastInputWasVoice: true });
        const overlay = useOverlayStore.getState();
        if (overlay.mode === 'mini') overlay.setMode('chat');
        const chat = useChatStore.getState();
        await chat.sendMessage(clean, chat.activeConversationId);
      },

      onToken: (messageId, token) => {
        const { enabled, readAloud, status, speed } = get();
        if (!enabled || !readAloud) return;
        if (messageId !== currentMessageId) {
          currentMessageId = messageId;
          chunker = createSentenceChunker();
        }
        for (const sentence of chunker.push(token)) {
          if (status?.ttsAvailable) void voiceSpeak(sentence).catch(() => {});
          else fallback().speak(sentence, speed);
        }
      },

      onResponseEnd: () => {
        const { enabled, readAloud, status, speed } = get();
        if (!enabled || !readAloud) return;
        for (const sentence of chunker.flush()) {
          if (status?.ttsAvailable) void voiceSpeak(sentence).catch(() => {});
          else fallback().speak(sentence, speed);
        }
        currentMessageId = null;
        if (status?.ttsAvailable) void voiceSpeakEnd().catch(() => {});
      },

      onOverlayToggled: visible => {
        const { enabled, autoListenOnOverlay, listen, stopListening } = get();
        if (!enabled) return;
        if (visible) {
          if (autoListenOnOverlay) void listen();
        } else {
          void stopListening();
        }
      },

      applyState: state => {
        const prev = get().state;
        set({ state, level: state === 'listening' ? get().level : 0 });
        // Fin d'une réponse orale : on rend la parole sans raccourci.
        if (prev === 'speaking' && state === 'idle') {
          const { continueAfterAnswer, lastInputWasVoice, enabled, listen } = get();
          const visible = useOverlayStore.getState().isVisible;
          if (enabled && continueAfterAnswer && lastInputWasVoice && visible) void listen();
        }
      },

      applyLevel: rms => {
        if (get().state === 'listening') set({ level: rms });
      },

      testVoice: () => {
        const { status, speed } = get();
        if (status?.ttsAvailable) {
          void voiceSpeak(TEST_SENTENCE)
            .then(() => voiceSpeakEnd())
            .catch(err => set({ hint: message(err) }));
        } else {
          fallback().speak(TEST_SENTENCE, speed);
        }
      },

      setEnabled: enabled => {
        set({ enabled });
        if (!enabled) {
          void get().stopSpeaking();
          void get().stopListening();
        } else {
          void voiceWarmup().catch(() => {});
        }
      },
      setReadAloud: readAloud => {
        set({ readAloud });
        if (!readAloud) void get().stopSpeaking();
      },
      setAutoListenOnOverlay: autoListenOnOverlay => set({ autoListenOnOverlay }),
      setContinueAfterAnswer: continueAfterAnswer => set({ continueAfterAnswer }),
      setVoice: voice => {
        set({ voice });
        void voiceConfigure({ voice, speed: get().speed }).catch(err =>
          set({ hint: message(err) }),
        );
      },
      setSpeed: speed => {
        set({ speed });
        void voiceConfigure({ voice: get().voice, speed }).catch(err =>
          set({ hint: message(err) }),
        );
      },
    }),
    {
      name: 'catdesk-voice',
      partialize: s => ({
        enabled: s.enabled,
        readAloud: s.readAloud,
        autoListenOnOverlay: s.autoListenOnOverlay,
        continueAfterAnswer: s.continueAfterAnswer,
        voice: s.voice,
        speed: s.speed,
      }),
    },
  ),
);

// Le bouton Stop du chat coupe aussi la voix — sans que chatStore ait à nous connaître.
useChatStore.subscribe((s, prev) => {
  if (s.status === 'interrupted' && prev.status !== 'interrupted') {
    void useVoiceStore.getState().stopSpeaking();
  }
});

// Bulle refermée (Échap, clic ailleurs) : un micro ouvert sans rien à l'écran
// n'est pas acceptable. La parole, elle, peut finir sa phrase.
useOverlayStore.subscribe((s, prev) => {
  if (!s.isVisible && prev.isVisible) void useVoiceStore.getState().stopListening();
});
