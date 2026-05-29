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
    arguments: string; // JSON string
  };
}

// ─── Streaming ────────────────────────────────────────────────

export type StreamChunk =
  | { type: 'token'; content: string }
  | { type: 'tool_call'; toolCall: OllamaToolCall }
  | { type: 'done'; totalTokens?: number }
  | { type: 'error'; error: string };
