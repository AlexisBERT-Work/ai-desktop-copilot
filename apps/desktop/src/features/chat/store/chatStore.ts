import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { invoke } from '@tauri-apps/api/core';
import type { Message, Conversation } from '@catdesk/shared-types';

/** État courant de l'agent, affiché comme petit texte sous le chat. */
export type AgentStatus =
  | 'idle'
  | 'thinking'    // requête envoyée, en attente du LLM
  | 'responding'  // tokens en cours de streaming
  | 'tool'        // un outil s'exécute (voir activeTool)
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
  selectedModel: string;
  /** True once the user manually picks a model — stops the adaptive default from overriding it. */
  userPickedModel: boolean;
  availableModels: string[];
  modelMode: 'auto' | 'light' | 'code';
  lightModel: string;
  codeModel: string;
  /** On-disk size (bytes) per installed model, from Ollama. Drives the VRAM warning. */
  modelSizes: Record<string, number>;
  /** Detected GPU VRAM in bytes, or null when undetectable (then: no warning). */
  vramBytes: number | null;

  // Actions
  sendMessage: (content: string, conversationId: string) => Promise<void>;
  newConversation: () => void;
  selectConversation: (id: string) => void;
  setModel: (model: string) => void;
  setModelMode: (mode: 'auto' | 'light' | 'code') => void;
  loadModels: () => Promise<void>;
  appendToken: (conversationId: string, messageId: string, token: string) => void;
  setPlan: (conversationId: string, messageId: string, steps: string[]) => void;
  setToolActivity: (tool: string | null) => void;
  setError: () => void;
  interrupt: () => Promise<void>;
  finalizeMessage: (conversationId: string, messageId: string) => void;
}

const DEFAULT_CONVERSATION_ID = crypto.randomUUID();

export const useChatStore = create<ChatState>()(
  immer((set, get) => ({
    conversations: [
      {
        id: DEFAULT_CONVERSATION_ID,
        title: 'New conversation',
        model: 'qwen2.5:7b',
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
    // Safe pre-load default; loadModels() replaces it with the VRAM-adaptive
    // recommendation (7B on weak/unknown GPUs, 14B where it fits).
    selectedModel: 'qwen2.5:7b',
    userPickedModel: false,
    // Pre-load placeholder; loadModels() overwrites it with the real installed
    // set. Mirrors the bundled lineup so the UI isn't empty before Ollama answers.
    availableModels: ['qwen3:14b', 'qwen2.5-coder:14b', 'qwen2.5:7b'],
    modelMode: 'auto',
    // Tier léger distinct du main (7B ~4.7 GB) : rend le mode « Léger » et la
    // rétrogradation auto réellement utiles, sans le français cassé du 3B. Tient
    // dans 10 GB de VRAM.
    lightModel: 'qwen2.5:7b',
    codeModel: 'qwen2.5-coder:14b',
    modelSizes: {},
    vramBytes: null,

    sendMessage: async (content, conversationId) => {
      const { selectedModel, modelMode, lightModel, codeModel } = get();
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
        // Invoke Tauri — streaming tokens come via events
        // La commande Rust prend un seul paramètre `args: ChatSendArgs`,
        // donc Tauri exige d'envelopper les champs sous la clé `args`.
        await invoke('chat_send', {
          args: {
            conversationId,
            message: content,
            messageId: assistantMessageId,
            modelId: selectedModel,
            useTools: true,
            modelMode,
            lightModel,
            codeModel,
          },
        });
      } catch (err) {
        set(s => {
          const msgs = s.messages[conversationId];
          const msg = msgs?.find(m => m.id === assistantMessageId);
          if (msg) msg.content = `❌ Erreur: ${String(err)}`;
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
        // Repli robuste si le routage d'id est imprécis : conversation active
        // + message en cours de streaming.
        const msgs = s.messages[conversationId] ?? s.messages[s.activeConversationId];
        const msg = msgs?.find(m => m.id === messageId)
          ?? msgs?.find(m => m.id === s.streamingMessageId);
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
      try { await invoke('chat_cancel'); } catch { /* best-effort */ }
    },

    setPlan: (conversationId, messageId, steps) => {
      if (!Array.isArray(steps) || steps.length === 0) return;
      set(s => {
        // Le routage du messageId est peu fiable côté bridge : on rattache au
        // message ciblé si trouvé, sinon au message en cours de streaming.
        const msgs = s.messages[conversationId] ?? s.messages[s.activeConversationId];
        const msg = msgs?.find(m => m.id === messageId)
          ?? msgs?.find(m => m.id === s.streamingMessageId);
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
          conv.messageCount = (s.messages[conversationId]?.length ?? 0);
        }
      });
    },

    newConversation: () => {
      const id = crypto.randomUUID();
      set(s => {
        s.conversations.unshift({
          id,
          title: 'New conversation',
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
      set(s => { s.activeConversationId = id; });
    },

    setModel: model => {
      set(s => { s.selectedModel = model; s.userPickedModel = true; });
    },

    setModelMode: mode => {
      set(s => { s.modelMode = mode; });
    },

    loadModels: async () => {
      try {
        const info = await invoke<{ name: string; sizeBytes: number }[]>('get_ollama_models_info');
        set(s => {
          s.availableModels = info.map(m => m.name);
          s.modelSizes = Object.fromEntries(info.map(m => [m.name, m.sizeBytes]));
        });
      } catch {
        // Keep defaults if Ollama not available
      }
      try {
        const vram = await invoke<number | null>('get_gpu_vram_bytes');
        set(s => { s.vramBytes = vram; });
      } catch {
        // VRAM undetectable → leave null, warnings stay off.
      }
      // Adaptive default: start on the model this machine can actually run well
      // (3B on weak/unknown GPUs, 14B where it fits). Skipped once the user has
      // manually chosen a model. Falls back to an installed model if the
      // recommendation isn't present.
      try {
        const recommended = await invoke<string>('get_recommended_model');
        set(s => {
          if (s.userPickedModel) return;
          s.selectedModel = s.availableModels.includes(recommended)
            ? recommended
            : (s.availableModels[0] ?? s.selectedModel);
        });
      } catch {
        // Recommendation unavailable (Ollama/GPU probe failed) → keep current.
      }
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
