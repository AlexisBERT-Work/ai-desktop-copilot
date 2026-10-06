import { appendFileSync } from 'fs';
import type { ToolResult } from '@catdesk/shared-types';
import { dataPath } from './lib/dataDir';

export class AuditLogger {
  private logPath: string;

  constructor() {
    // Un fichier par jour, sous data/audit/ — même convention que le journal
    // d'audit du cœur Rust (core/audit.rs), pour un log combiné uniforme.
    const date = new Date().toISOString().slice(0, 10);
    this.logPath = dataPath(`audit-${date}.log`, undefined, 'audit');
  }

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
    // Sanitize sensitive data from args before logging
    const safeArgs = this.sanitizeArgs(tool, args);
    this.write('TOOL_CALL', {
      runId,
      tool,
      args: safeArgs,
      success: result.success,
      // `error` n'existe que sur la branche d'échec de l'union : l'omettre
      // plutôt que d'écrire `undefined` dans la ligne d'audit.
      ...(result.success ? {} : { error: result.error }),
    });
  }

  logPermission(requestId: string, tool: string, granted: boolean, reason?: string): void {
    this.write('PERMISSION', { requestId, tool, granted, reason });
  }

  private sanitizeArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
    const sanitized = { ...args };
    // Don't log file contents in write operations
    if (tool === 'write_file' && 'content' in sanitized) {
      sanitized['content'] = `[${String(sanitized['content']).length} chars]`;
    }
    // Don't log clipboard content
    if (tool === 'write_clipboard' && 'content' in sanitized) {
      sanitized['content'] = '[clipboard content]';
    }
    return sanitized;
  }

  private write(event: string, data: Record<string, unknown>): void {
    const entry = {
      ts: new Date().toISOString(),
      event,
      ...data,
    };
    try {
      appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
    } catch {
      // Non-fatal: audit log failure shouldn't crash the runtime
    }
  }
}
