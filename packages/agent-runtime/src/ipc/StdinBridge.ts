import type { JsonRpcRequest, JsonRpcResponse, AgentMethod } from '@catdesk/shared-types';
import type { AgentOrchestrator } from '../AgentOrchestrator';
import { createLogger } from '../logger';

const log = createLogger('ipc:bridge');

/**
 * JSON-RPC 2.0 bridge over stdin/stdout
 * Handles communication between Tauri Rust core and Node.js agent runtime
 */
export class StdinBridge {
  private buffer = '';
  /** Abort controller for the run in progress, used by the Stop button. */
  private currentAbort: AbortController | null = null;

  constructor(
    private orchestrator: AgentOrchestrator,
    private onSetConfig?: (
      symbols: string[],
      formulas: { name: string; expression: string }[],
    ) => void | Promise<void>,
    /** Déclenche une publication immédiate de la revue de presse (bouton admin). */
    private onRunPressDigest?: () => void | Promise<void>,
  ) {}

  start(): void {
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.processBuffer();
    });
    process.stdin.on('end', () => {
      log.info('stdin closed — shutting down');
      process.exit(0);
    });
    log.info('StdinBridge listening on stdin');
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const request = JSON.parse(trimmed) as JsonRpcRequest;
        this.handleRequest(request).catch(err => {
          log.error('Request handler failed', { error: String(err) });
        });
      } catch {
        log.warn('Invalid JSON received', { line: trimmed.slice(0, 100) });
      }
    }
  }

  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    log.debug('Request received', { id: request.id, method: request.method });

    // Interruption: stop the in-flight run (Stop button). Handled before the
    // typed switch since it's a control signal, not an AgentMethod.
    if (request.method === 'agent.cancel') {
      this.currentAbort?.abort();
      this.sendResponse(request.id, { ok: true });
      return;
    }

    // Publication immédiate de la revue de presse (bouton « Publier maintenant »
    // de la console admin). No-op si le planificateur n'est pas actif (poste
    // client sans identifiants admin) — on répond ok sans rien faire. Le run est
    // lancé sans l'attendre (~1 min) : les dailys arrivent via Realtime.
    if (request.method === 'press.run_now') {
      if (this.onRunPressDigest === undefined) {
        this.sendResponse(request.id, { ok: false, reason: 'press-digest-inactive' });
        return;
      }
      void this.onRunPressDigest();
      this.sendResponse(request.id, { ok: true });
      return;
    }

    // Config bourse pilotée par l'UI (symboles + formules des widgets `stocks`).
    if (request.method === 'market.set_watchlist') {
      const params = request.params as { symbols?: unknown; formulas?: unknown };
      const symbols = Array.isArray(params.symbols)
        ? params.symbols.filter((s): s is string => typeof s === 'string')
        : [];
      const formulas = Array.isArray(params.formulas)
        ? params.formulas.flatMap((f) => {
            if (f === null || typeof f !== 'object') return [];
            const o = f as { name?: unknown; expression?: unknown };
            return typeof o.name === 'string' && typeof o.expression === 'string'
              ? [{ name: o.name, expression: o.expression }]
              : [];
          })
        : [];
      await this.onSetConfig?.(symbols, formulas);
      this.sendResponse(request.id, { ok: true });
      return;
    }

    try {
      switch (request.method as AgentMethod) {
        case 'agent.process':
          await this.handleAgentProcess(request);
          break;

        case 'health.check':
          this.sendResponse(request.id, { status: 'ok', pid: process.pid });
          break;

        case 'models.list':
          // Forwarded to OllamaClient
          this.sendResponse(request.id, { models: [] });
          break;

        case 'settings.update': {
          const params = request.params as { safeMode?: boolean };
          this.orchestrator.updatePermissions({
            ...(params.safeMode !== undefined ? { safeMode: params.safeMode } : {}),
          });
          this.sendResponse(request.id, { ok: true });
          break;
        }

        default:
          this.sendError(request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (err) {
      this.sendError(request.id, -32603, `Internal error: ${String(err)}`);
    }
  }

  private async handleAgentProcess(request: JsonRpcRequest): Promise<void> {
    const params = request.params as {
      input: string;
      conversationId: string;
      messageId?: string;
      config: Parameters<AgentOrchestrator['process']>[2];
    };

    // Fresh abort controller for this run so a later `agent.cancel` can stop it.
    const abort = new AbortController();
    this.currentAbort = abort;

    try {
      for await (const step of this.orchestrator.process(
        params.input,
        params.conversationId,
        params.config,
        abort.signal,
      )) {
        // Inject conversation/message ids so Tauri can route the event to the
        // right message (the orchestrator steps don't carry them).
        this.sendNotification('agent.step', {
          id: request.id,
          step: { ...step, conversationId: params.conversationId, messageId: params.messageId },
        });
      }

      // Final response
      this.sendResponse(request.id, { done: true });
    } catch (err) {
      this.sendError(request.id, -32603, String(err));
    } finally {
      if (this.currentAbort === abort) this.currentAbort = null;
    }
  }

  private sendResponse<T>(id: string | number, result: T): void {
    const response: JsonRpcResponse<T> = { jsonrpc: '2.0', id, result };
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  private sendError(id: string | number, code: number, message: string): void {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  private sendNotification(method: string, params: unknown): void {
    const notification = { jsonrpc: '2.0', method, params };
    process.stdout.write(JSON.stringify(notification) + '\n');
  }
}
