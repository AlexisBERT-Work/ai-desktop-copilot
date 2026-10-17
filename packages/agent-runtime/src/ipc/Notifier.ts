/** Émet une notification JSON-RPC (sans réponse attendue) vers l'hôte. */
export type NotifyFn = (method: string, params: unknown) => void;

/**
 * Writes a JSON-RPC 2.0 notification to stdout, outside any request/response
 * cycle. The Rust bridge reads these lines and re-emits them as Tauri events.
 * Seul point d'écriture des notifications agent → hôte.
 */
export const stdoutNotifier: NotifyFn = (method, params) => {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
};
