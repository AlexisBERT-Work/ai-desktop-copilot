import type { RiskLevel } from './ipc';

// ─── Agent Configuration ───────────────────────────────────────

export interface AgentConfig {
  model: string;
  temperature?: number;
  maxIterations?: number;
  enabledTools?: string[];
  useScreenContext?: boolean;
  useMemory?: boolean;
  safeMode?: boolean;
}

// ─── Agent Execution Steps ─────────────────────────────────────

export type AgentStep =
  | { type: 'token'; content: string }
  | { type: 'tool_start'; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; result: ToolResult }
  | { type: 'tool_error'; toolName: string; error: string }
  | { type: 'tool_blocked'; toolName: string; reason: string }
  | { type: 'done'; content: string; totalTokens?: number }
  | { type: 'error'; content: string; code?: string };

// ─── Tool Types ────────────────────────────────────────────────

export type ToolCategory =
  | 'filesystem'
  | 'system'
  | 'screen'
  | 'clipboard'
  | 'automation'
  | 'memory'
  | 'web';

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  schema: JSONSchemaObject;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ActiveToolCall extends ToolCall {
  status: 'pending' | 'awaiting_permission' | 'executing' | 'complete' | 'failed' | 'blocked';
  startedAt: number;
  result?: ToolResult;
  approve?: () => void;
  approveAlways?: () => void;
  reject?: () => void;
}

// ─── Ollama Schema ────────────────────────────────────────────

export interface OllamaToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchemaObject;
  };
}

// ─── Minimal JSON Schema ──────────────────────────────────────

export interface JSONSchemaObject {
  type: 'object';
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export type JSONSchemaProperty =
  | { type: 'string'; description?: string; enum?: string[]; default?: string }
  | { type: 'number'; description?: string; minimum?: number; maximum?: number; default?: number }
  | { type: 'boolean'; description?: string; default?: boolean }
  | { type: 'array'; items: JSONSchemaProperty; description?: string }
  | JSONSchemaObject;
