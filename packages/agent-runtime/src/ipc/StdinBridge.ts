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

  constructor(private orchestrator: AgentOrchestrator) {}

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

    try {
      for await (const step of this.orchestrator.process(
        params.input,
        params.conversationId,
        params.config,
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
