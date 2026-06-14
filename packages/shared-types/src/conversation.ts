import type { Attachment } from './ipc';
import type { ToolCall } from './agent';

// ─── Conversation & Messages ───────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  attachments?: Attachment[];
  toolCalls?: ToolCall[];
  toolCallId?: string; // For tool result messages
  plan?: string[]; // Plan steps when planning was enabled
  createdAt: number;
  metadata?: MessageMetadata;
}

export interface MessageMetadata {
  model?: string;
  totalTokens?: number;
  durationMs?: number;
  toolsUsed?: string[];
}

export interface Conversation {
  id: string;
  title?: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  tags?: string[];
}

export interface ConversationSummary extends Conversation {
  lastMessage?: string;
}

// ─── LLM Message Format (for Ollama API) ──────────────────────

export interface OllamaMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  images?: string[]; // Base64 for vision
  tool_calls?: OllamaToolCall[];
  tool_call_id?: string;
}

export interface OllamaToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    // Ollama returns arguments as an object and, crucially, expects them back
    // as an OBJECT when the assistant message is replayed in a follow-up
    // request. Sending a JSON *string* triggers a 400 ("Value looks like object,
    // but can't find closing '}' symbol"). We allow both but normalise to an
    // object before sending (see OllamaClient).
    arguments: string | Record<string, unknown>;
  };
}

// ─── Streaming ────────────────────────────────────────────────

export type StreamChunk =
  | { type: 'token'; content: string }
  | { type: 'tool_call'; toolCall: OllamaToolCall }
  | { type: 'done'; totalTokens?: number }
  | { type: 'error'; error: string };
