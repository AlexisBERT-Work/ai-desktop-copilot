// ─── Contrat IPC partagé Rust ↔ TypeScript ─────────────────────
//
// Source de vérité des noms d'événements Tauri et des méthodes JSON-RPC.
// Le miroir Rust (apps/desktop/src-tauri/src/ipc/protocol.rs) est vérifié
// contre CE fichier par un test cargo (`include_str!`) : toute divergence
// casse `cargo test`. Ne pas renommer/déplacer ce fichier sans adapter le
// test Rust.

/** Événements Tauri (Rust → React), convention `namespace:event`. */
export const TAURI_EVENTS = {
  uiOverlayToggle: 'ui:overlay-toggle',
  chatToken: 'chat:token',
  chatDone: 'chat:done',
  chatError: 'chat:error',
  agentPlan: 'agent:plan',
  agentToolCall: 'agent:tool_call',
  permissionRequest: 'permission:request',
  proactiveSuggestion: 'proactive:suggestion',
  marketUpdate: 'market:update',
  pressFeeds: 'press:feeds',
  dailiesLocal: 'dailies:local',
} as const;

export type TauriEventName = (typeof TAURI_EVENTS)[keyof typeof TAURI_EVENTS];

/** Méthodes JSON-RPC hôte → agent (requêtes avec réponse). */
export const RPC_METHODS = {
  agentProcess: 'agent.process',
  agentCancel: 'agent.cancel',
  permissionResponse: 'permission.response',
  marketSetWatchlist: 'market.set_watchlist',
  pressRunNow: 'press.run_now',
  pressFeedsSave: 'press.feeds.save',
  pressFeedsDelete: 'press.feeds.delete',
  pressLocalRunNow: 'press.local.run_now',
  pressLocalSync: 'press.local.sync',
  settingsUpdate: 'settings.update',
} as const;

export type RpcMethodName = (typeof RPC_METHODS)[keyof typeof RPC_METHODS];

/** Notifications JSON-RPC agent → hôte (sans réponse, re-émises en événements Tauri). */
export const RPC_NOTIFICATIONS = {
  agentStep: 'agent.step',
  permissionRequest: 'permission.request',
  proactiveSuggestion: 'proactive.suggestion',
  marketUpdate: 'market.update',
  pressFeeds: 'press.feeds',
  dailiesLocal: 'dailies.local',
} as const;

export type RpcNotificationName = (typeof RPC_NOTIFICATIONS)[keyof typeof RPC_NOTIFICATIONS];
