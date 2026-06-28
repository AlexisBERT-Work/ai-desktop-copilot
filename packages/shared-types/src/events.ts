// ─── EventBus Types ────────────────────────────────────────────

export type AppEvent =
  // Chat events
  | { type: 'chat:message-sent'; conversationId: string; messageId: string }
  | { type: 'chat:token-received'; conversationId: string; messageId: string; token: string }
  | { type: 'chat:response-complete'; conversationId: string; messageId: string }
  | { type: 'chat:error'; conversationId: string; error: string }
  // Agent events
  | { type: 'agent:run-started'; runId: string; conversationId: string }
  | { type: 'agent:run-complete'; runId: string; success: boolean }
  | { type: 'agent:tool-called'; runId: string; toolName: string }
  | { type: 'agent:tool-result'; runId: string; toolName: string; success: boolean }
  | { type: 'agent:iteration'; runId: string; iteration: number }
  // Permission events
  | { type: 'permission:requested'; requestId: string; tool: string }
  | { type: 'permission:granted'; requestId: string; tool: string }
  | { type: 'permission:denied'; requestId: string; tool: string; reason: string }
  // UI events
  | { type: 'ui:overlay-toggle' }
  | { type: 'ui:mode-change'; mode: OverlayMode }
  | { type: 'ui:command-palette-open' }
  // System events
  | { type: 'system:screen-captured'; imageBase64: string }
  | { type: 'system:clipboard-changed'; content: string }
  | { type: 'system:notification'; title: string; body: string };

export type OverlayMode = 'mini' | 'chat' | 'command' | 'settings' | 'hidden';

export type AppEventType = AppEvent['type'];
export type AppEventByType<T extends AppEventType> = Extract<AppEvent, { type: T }>;
