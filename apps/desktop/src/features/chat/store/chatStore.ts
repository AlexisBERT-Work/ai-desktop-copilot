import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { invoke } from '@tauri-apps/api/core';
import type { Message, Conversation } from '@neurodesk/shared-types';

interface ChatState {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  activeConversationId: string;
  isStreaming: boolean;
  streamingMessageId: string | null;
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
        });
      }
    },

    appendToken: (conversationId, messageId, token) => {
      set(s => {
        const msg = s.messages[conversationId]?.find(m => m.id === messageId);
        if (msg) msg.content += token;
      });
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
