import { appendFileSync } from 'fs';
import type { PermissionResult, ToolResult } from '@catdesk/shared-types';
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

  /**
   * Décision de permission : refus, ou accord avec sa portée (`once` : cette
   * fois ; `site` : ce site pour la session, `site` dit lequel ; `session`).
   * Un accord « ce site » réutilisé sans redemander est tracé ici, sans
   * `requestId` : c'est la seule trace qu'il ait servi.
   */
  logPermission(runId: string, tool: string, result: PermissionResult): void {
    this.write('PERMISSION', {
      runId,
      tool,
      granted: result.granted,
      ...(result.scope !== undefined ? { scope: result.scope } : {}),
      ...(result.site !== undefined ? { site: result.site } : {}),
      ...(result.requestId !== undefined ? { requestId: result.requestId } : {}),
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
    });
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
