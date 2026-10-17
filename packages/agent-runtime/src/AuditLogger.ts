import { appendFileSync } from 'fs';
import type { ToolResult } from '@catdesk/shared-types';
import { dataPath } from './lib/dataDir';
import { redactArgs } from './security/redactArgs';

/**
 * Journal d'audit de l'agent : une ligne JSON `{ts, event, ...}` par
 * événement, un fichier par jour sous `<data>/audit/` — même convention que le
 * journal du cœur Rust (core/audit.rs), dans le même dossier.
 */
export class AuditLogger {
  constructor(private readonly now: () => Date = () => new Date()) {}

  startRun(runId: string, conversationId: string, input: string): void {
    this.write('RUN_START', { runId, conversationId, inputLength: input.length });
  }

  completeRun(
    runId: string,
    status: 'success' | 'error' | 'max_iterations' | 'interrupted',
    output?: string,
  ): void {
    this.write('RUN_END', { runId, status, outputLength: output?.length ?? 0 });
  }

  logToolCall(
    runId: string,
    tool: string,
    args: Record<string, unknown>,
    result: ToolResult,
  ): void {
    this.write('TOOL_CALL', {
      runId,
      tool,
      // Secrets et contenus utilisateur masqués avant d'atteindre le disque.
      args: redactArgs(args),
      success: result.success,
      // `error` n'existe que sur la branche d'échec de l'union : l'omettre
      // plutôt que d'écrire `undefined` dans la ligne d'audit.
      ...(result.success ? {} : { error: result.error }),
    });
  }

  logPermission(requestId: string, tool: string, granted: boolean, reason?: string): void {
    this.write('PERMISSION', { requestId, tool, granted, reason });
  }

  /**
   * Le fichier du jour est résolu À CHAQUE écriture : figé au démarrage, un
   * agent resté ouvert après minuit écrivait encore dans le fichier de la veille.
   */
  private write(event: string, data: Record<string, unknown>): void {
    const now = this.now();
    const path = dataPath(`audit-${now.toISOString().slice(0, 10)}.log`, undefined, 'audit');
    try {
      appendFileSync(path, JSON.stringify({ ts: now.toISOString(), event, ...data }) + '\n');
    } catch {
      // Non-fatal: audit log failure shouldn't crash the runtime
    }
  }
}
