// ════════════════════════════════════════════════════════════════
// IPC TYPES — React ↔ Tauri Rust ↔ Node.js Agent Runtime
// ════════════════════════════════════════════════════════════════

import type { RpcMethodName } from './ipc-contract';

// ─── Tauri Commands (React → Rust via invoke) ──────────────────

/**
 * Arguments de la commande `chat_send` (miroir de `ChatSendArgs`, chat.rs).
 * Les réglages absents prennent les défauts de l'agent.
 */
export interface ChatSendPayload {
  conversationId: string;
  message: string;
  /** Id du message assistant à remplir : corrèle les tokens streamés. */
  messageId: string;
  modelId: string;
  temperature?: number | undefined;
  maxIterations?: number | undefined;
  modelMode?: 'auto' | 'light' | 'code' | undefined;
  lightModel?: string | undefined;
  codeModel?: string | undefined;
  usePlanning?: boolean | undefined;
}

export interface Attachment {
  type: 'file' | 'image' | 'screenshot';
  name: string;
  /** Base64 encoded content or file path */
  content: string;
  mimeType: string;
  size: number;
}

// ─── Tauri Events (Rust → React via listen) ────────────────────

export interface TokenEvent {
  conversationId: string;
  messageId: string;
  token: string;
}

export interface DoneEvent {
  conversationId: string;
  messageId: string;
  totalTokens: number;
  durationMs: number;
}

export interface ErrorEvent {
  conversationId: string;
  messageId?: string;
  code: string;
  message: string;
}

export interface PermissionRequestEvent {
  requestId: string;
  tool: string;
  description: string;
  riskLevel: RiskLevel;
  args: Record<string, unknown>;
  preview?: string;
}

export interface PermissionResponsePayload {
  requestId: string;
  granted: boolean;
  remember?: boolean;
}

// ─── JSON-RPC (Rust ↔ Node.js) ────────────────────────────────

export interface JsonRpcRequest<P = unknown> {
  jsonrpc: '2.0';
  /**
   * Absent pour une NOTIFICATION (message sans réponse attendue) : le même
   * canal stdin transporte les deux, cf. `permission.response` émise par
   * `bridge.rs::send_permission_response`.
   */
  id?: string | number;
  method: AgentMethod;
  params: P;
}

export interface JsonRpcResponse<R = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: R;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Méthodes JSON-RPC hôte → agent. Dérivé de `RPC_METHODS` (ipc-contract.ts),
 * qui est LA source de vérité — et que le miroir Rust vérifie par un test
 * cargo. Auparavant une union écrite à la main : elle avait divergé dans les
 * deux sens (6 méthodes fantômes ici, `permission.response` manquante).
 */
export type AgentMethod = RpcMethodName;

// ─── Shared types ──────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
