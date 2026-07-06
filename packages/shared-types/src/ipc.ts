// ════════════════════════════════════════════════════════════════
// IPC TYPES — React ↔ Tauri Rust ↔ Node.js Agent Runtime
// ════════════════════════════════════════════════════════════════

// ─── Tauri Commands (React → Rust via invoke) ──────────────────

export interface ChatSendPayload {
  conversationId: string;
  message: string;
  attachments?: Attachment[];
  modelId: string;
  useTools: boolean;
}

export interface Attachment {
  type: 'file' | 'image' | 'screenshot';
  name: string;
  /** Base64 encoded content or file path */
  content: string;
  mimeType: string;
  size: number;
}

export interface CapturePayload {
  region?: ScreenRegion;
  includeActiveWindowOnly?: boolean;
}

export interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FileReadPayload {
  path: string;
  encoding?: 'utf-8' | 'base64';
  maxBytes?: number;
}

export interface RunCommandPayload {
  command: string;
  shell: 'powershell' | 'cmd';
  workdir?: string;
  timeoutMs?: number;
}

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface ClipboardWritePayload {
  content: string;
  format?: 'text' | 'html' | 'rtf';
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

export interface ToolCallEvent {
  runId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  requiresConfirmation: boolean;
  confirmationMessage?: string;
}

export interface ToolResultEvent {
  runId: string;
  toolCallId: string;
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
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

export interface SystemNotificationPayload {
  title: string;
  body: string;
  level: 'info' | 'success' | 'warning' | 'error';
}

// ─── JSON-RPC (Rust ↔ Node.js) ────────────────────────────────

export interface JsonRpcRequest<P = unknown> {
  jsonrpc: '2.0';
  id: string | number;
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

export type AgentMethod =
  | 'agent.process'
  | 'agent.stream'
  | 'agent.cancel'
  | 'market.set_watchlist'
  | 'press.run_now'
  | 'press.feeds.save'
  | 'press.feeds.delete'
  | 'press.local.run_now'
  | 'press.local.sync'
  | 'tools.execute'
  | 'tools.list'
  | 'memory.store'
  | 'memory.retrieve'
  | 'context.update'
  | 'models.list'
  | 'health.check'
  | 'settings.update';

// ─── Shared types ──────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

