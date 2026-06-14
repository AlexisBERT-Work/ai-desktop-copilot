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
  availableModels: string[];
  modelMode: 'auto' | 'light' | 'code';
  lightModel: string;
  codeModel: string;

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
    selectedModel: 'qwen2.5:7b',
    availableModels: ['qwen2.5:7b', 'llama3.2:3b', 'deepseek-r1:7b'],
    modelMode: 'auto',
    lightModel: 'qwen2.5:7b',
    codeModel: 'qwen2.5-coder:14b',

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

    finalizeMessage: (conversationId, messageId) => {
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
      set(s => { s.selectedModel = model; });
    },

    setModelMode: mode => {
      set(s => { s.modelMode = mode; });
    },

    loadModels: async () => {
      try {
        const models = await invoke<string[]>('get_ollama_models');
        set(s => { s.availableModels = models; });
      } catch {
        // Keep defaults if Ollama not available
      }
    },
  })),
);
