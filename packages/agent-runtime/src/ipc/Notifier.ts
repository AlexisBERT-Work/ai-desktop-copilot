import type { NotifyFn } from '../SpiralMonitor';

/**
 * Writes a JSON-RPC 2.0 notification to stdout, outside any request/response
 * cycle. The Rust bridge reads these lines and re-emits them as Tauri events.
 * Used for proactive, agent-initiated messages (e.g. spiral suggestions).
 */
export const stdoutNotifier: NotifyFn = (method, params) => {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
};
