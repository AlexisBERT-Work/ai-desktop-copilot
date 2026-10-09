import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Message, Conversation } from '@catdesk/shared-types';
import { DEFAULT_CHAT_MODEL } from '@catdesk/shared-types';
import { chatSend, chatCancel, chatWarmup } from '../../../shared/api/chat';
import { useSettingsStore } from '../../settings/settingsStore';
import {
  getOllamaModelsInfo,
  getGpuVramBytes,
  getRecommendedModel,
} from '../../../shared/api/models';

/** État courant de l'agent, affiché comme petit texte sous le chat. */
export type AgentStatus =
  | 'idle'
  | 'thinking' // requête envoyée, en attente du LLM
  | 'responding' // tokens en cours de streaming
  | 'tool' // un outil s'exécute (voir activeTool)
  | 'interrupted' // arrêté par l'utilisateur
  | 'error';

interface ChatState {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  activeConversationId: string;
  isStreaming: boolean;
  streamingMessageId: string | null;
  status: AgentStatus;
  activeTool: string | null;
  /** Modèle des prochains messages : le choix persisté (Réglages), sinon le recommandé. */
  selectedModel: string;
  /** Modèle que CatDesk recommande pour cette machine (getRecommendedModel). */
  recommendedModel: string;
  availableModels: string[];
  /** On-disk size (bytes) per installed model, from Ollama. Drives the VRAM warning. */
  modelSizes: Record<string, number>;
  /** Detected GPU VRAM in bytes, or null when undetectable (then: no warning). */
  vramBytes: number | null;

  // Actions
  sendMessage: (content: string, conversationId: string) => Promise<void>;
  newConversation: () => void;
  selectConversation: (id: string) => void;
  /**
   * Choisit le modèle (null = revenir au recommandé). Persisté dans les
   * réglages : le sélecteur du chat et Réglages › Modèle ne font plus qu'un.
   */
  chooseModel: (model: string | null) => void;
  loadModels: () => Promise<void>;
  appendToken: (conversationId: string, messageId: string, token: string) => void;
  setPlan: (conversationId: string, messageId: string, steps: string[]) => void;
  setToolActivity: (tool: string | null) => void;
  setError: () => void;
  interrupt: () => Promise<void>;
  /**
   * L'utilisateur s'apprête à écrire (champ focalisé, frappe) : préchauffe le
   * modèle. Limité à un appel par WARMUP_THROTTLE_MS ; l'agent l'ignore de
   * toute façon s'il vient de servir. Ne lève jamais.
   */
  warmUp: () => void;
  finalizeMessage: (conversationId: string, messageId: string) => void;
}

/**
 * Un préchauffage par minute au plus : il coûte une requête IPC, et le modèle
 * reste chaud plusieurs minutes une fois chargé.
 */
const WARMUP_THROTTLE_MS = 60_000;
let lastWarmupAt = 0;
let lastWarmupConversation: string | null = null;

const DEFAULT_CONVERSATION_ID = crypto.randomUUID();
const NEW_CONVERSATION_TITLE = 'Nouvelle conversation';

/** Modèle à utiliser : le choix persisté s'il est installé, sinon le recommandé. */
function resolveModel(preferred: string | null, recommended: string, available: string[]): string {
  if (preferred !== null && available.includes(preferred)) return preferred;
  if (available.includes(recommended)) return recommended;
  return available[0] ?? recommended;
}

export const useChatStore = create<ChatState>()(
  immer((set, get) => ({
    conversations: [
      {
        id: DEFAULT_CONVERSATION_ID,
        title: NEW_CONVERSATION_TITLE,
        model: DEFAULT_CHAT_MODEL,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
      },
    ],
    messages: { [DEFAULT_CONVERSATION_ID]: [] },
    activeConversationId: DEFAULT_CONVERSATION_ID,
    isStreaming: false,
    streamingMessageId: null,
    status: 'idle',
    activeTool: null,
    // Valeurs d'attente : loadModels() les remplace par l'inventaire réel
    // d'Ollama et la recommandation du cœur.
    selectedModel: useSettingsStore.getState().defaultModel ?? DEFAULT_CHAT_MODEL,
    recommendedModel: DEFAULT_CHAT_MODEL,
    availableModels: [DEFAULT_CHAT_MODEL],
    modelSizes: {},
    vramBytes: null,

    sendMessage: async (content, conversationId) => {
      const { selectedModel } = get();
      const { temperature, maxIterations } = useSettingsStore.getState();
      const userMessageId = crypto.randomUUID();
      const assistantMessageId = crypto.randomUUID();

      // Add user message
      set(s => {
        const msgs = s.messages[conversationId] ?? [];
        msgs.push({
          id: userMessageId,
          conversationId,
          role: 'user',
          content,
          createdAt: Date.now(),
        });
        s.messages[conversationId] = msgs;
        s.isStreaming = true;
        s.streamingMessageId = assistantMessageId;
        s.status = 'thinking';
        s.activeTool = null;
      });

      // Add placeholder assistant message
      set(s => {
        s.messages[conversationId]!.push({
          id: assistantMessageId,
          conversationId,
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
        });
      });

      try {
        // Appel Tauri via la couche API — les tokens reviennent en événements.
        // Un seul modèle de chat (tri 2026-07-20) : plus de modes light/code —
        // sans lightModel/codeModel, le runtime ne rétrograde jamais (le swap
        // VRAM 14b↔7b coûtait plus cher que la réponse elle-même).
        await chatSend({
          conversationId,
          message: content,
          messageId: assistantMessageId,
          modelId: selectedModel,
          temperature,
          maxIterations,
        });
      } catch (err) {
        set(s => {
          const msgs = s.messages[conversationId];
          const msg = msgs?.find(m => m.id === assistantMessageId);
          if (msg) msg.content = `**Erreur :** ${String(err)}`;
          s.isStreaming = false;
          s.streamingMessageId = null;
          s.status = 'error';
          s.activeTool = null;
        });
      }
    },

    appendToken: (conversationId, messageId, token) => {
      set(s => {
        // Ignore les tokens tardifs après une interruption / fin.
        if (!s.isStreaming) return;
        // Routage strict : chaque step porte ses ids de bout en bout
        // (buildStepNotification côté agent, dispatch_agent_step côté Rust).
        const msg = s.messages[conversationId]?.find(m => m.id === messageId);
        if (msg) {
          msg.content += token;
          // Premier token reçu → on passe de « réfléchit » à « écrit ».
          s.status = 'responding';
          s.activeTool = null;
        }
      });
    },

    setToolActivity: tool => {
      set(s => {
        if (!s.isStreaming) return;
        if (tool) {
          s.status = 'tool';
          s.activeTool = tool;
        } else {
          // Outil terminé → l'agent repart vers le LLM.
          s.status = 'thinking';
          s.activeTool = null;
        }
      });
    },

    setError: () => {
      set(s => {
        s.isStreaming = false;
        s.streamingMessageId = null;
        s.status = 'error';
        s.activeTool = null;
      });
    },

    warmUp: () => {
      const { isStreaming, selectedModel, activeConversationId } = get();
      const now = Date.now();
      // Une autre conversation ouverte : son historique est à relire, on passe
      // outre la limite d'un appel par minute.
      const sameConversation = activeConversationId === lastWarmupConversation;
      if (isStreaming || (sameConversation && now - lastWarmupAt < WARMUP_THROTTLE_MS)) return;
      lastWarmupAt = now;
      lastWarmupConversation = activeConversationId;
      // Best-effort : un agent pas encore prêt n'est pas une erreur à montrer.
      chatWarmup(selectedModel, activeConversationId).catch(() => undefined);
    },

    interrupt: async () => {
      const { isStreaming } = get();
      if (!isStreaming) return;
      set(s => {
        s.isStreaming = false;
        s.streamingMessageId = null;
        s.status = 'interrupted';
        s.activeTool = null;
      });
      // Demande au backend d'arrêter réellement la génération en cours.
      try {
        await chatCancel();
      } catch {
        /* best-effort */
      }
    },

    setPlan: (conversationId, messageId, steps) => {
      if (!Array.isArray(steps) || steps.length === 0) return;
      set(s => {
        const msg = s.messages[conversationId]?.find(m => m.id === messageId);
        if (msg) msg.plan = steps;
      });
    },

    finalizeMessage: (conversationId, _messageId) => {
      set(s => {
        s.isStreaming = false;
        s.streamingMessageId = null;
        // Conserve un état terminal explicite (interrompu/erreur) ; sinon repos.
        if (s.status !== 'interrupted' && s.status !== 'error') s.status = 'idle';
        s.activeTool = null;
        const conv = s.conversations.find(c => c.id === conversationId);
        if (conv) {
          conv.updatedAt = Date.now();
          conv.messageCount = s.messages[conversationId]?.length ?? 0;
        }
      });
    },

    newConversation: () => {
      const id = crypto.randomUUID();
      set(s => {
        s.conversations.unshift({
          id,
          title: NEW_CONVERSATION_TITLE,
          model: s.selectedModel,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: 0,
        });
        s.messages[id] = [];
        s.activeConversationId = id;
      });
    },

    selectConversation: id => {
      set(s => {
        s.activeConversationId = id;
      });
      // Une question suit souvent : relire d'avance l'historique de celle-ci.
      get().warmUp();
    },

    chooseModel: model => {
      useSettingsStore.getState().setDefaultModel(model);
      set(s => {
        s.selectedModel = resolveModel(model, s.recommendedModel, s.availableModels);
      });
    },

    loadModels: async () => {
      try {
        const info = await getOllamaModelsInfo();
        set(s => {
          s.availableModels = info.map(m => m.name);
          s.modelSizes = Object.fromEntries(info.map(m => [m.name, m.sizeBytes]));
        });
      } catch {
        // Keep defaults if Ollama not available
      }
      try {
        const vram = await getGpuVramBytes();
        set(s => {
          s.vramBytes = vram;
        });
      } catch {
        // VRAM undetectable → leave null, warnings stay off.
      }
      // Recommandation du cœur (un seul modèle de chat aujourd'hui), puis
      // résolution : choix persisté s'il est installé, sinon le recommandé.
      try {
        const recommended = await getRecommendedModel();
        set(s => {
          s.recommendedModel = recommended;
        });
      } catch {
        // Recommandation indisponible → on garde la valeur courante.
      }
      set(s => {
        s.selectedModel = resolveModel(
          useSettingsStore.getState().defaultModel,
          s.recommendedModel,
          s.availableModels,
        );
      });
    },
  })),
);

/**
 * Warn when a model's weights are likely to exceed available VRAM and spill to
 * system RAM (5-10x slower). Returns null when there's nothing to flag or when
 * VRAM is unknown. The 0.85 factor leaves headroom for the KV cache, context
 * and compute buffers that load alongside the weights.
 */
export function modelVramWarning(
  sizeBytes: number | undefined,
  vramBytes: number | null,
): { modelGb: number; vramGb: number } | null {
  if (!sizeBytes || !vramBytes) return null;
  if (sizeBytes <= vramBytes * 0.85) return null;
  const gb = (b: number) => Math.round((b / 1e9) * 10) / 10;
  return { modelGb: gb(sizeBytes), vramGb: gb(vramBytes) };
}
