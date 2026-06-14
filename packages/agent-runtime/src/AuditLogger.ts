import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { ToolResult } from '@catdesk/shared-types';

export class AuditLogger {
  private logPath: string;

  constructor() {
    const dataDir = process.env['CATDESK_DATA_DIR'] ?? join(process.cwd(), 'data');
    const auditDir = join(dataDir, 'audit');
    mkdirSync(auditDir, { recursive: true });

    const date = new Date().toISOString().slice(0, 10);
    this.logPath = join(auditDir, `audit-${date}.log`);
  }

  startRun(runId: string, conversationId: string, input: string): void {
    this.write('RUN_START', { runId, conversationId, inputLength: input.length });
  }

  completeRun(runId: string, status: 'success' | 'error' | 'max_iterations' | 'interrupted', output?: string): void {
    this.write('RUN_END', { runId, status, outputLength: output?.length ?? 0 });
  }

  logToolCall(runId: string, tool: string, args: Record<string, unknown>, result: ToolResult): void {
    // Sanitize sensitive data from args before logging
    const safeArgs = this.sanitizeArgs(tool, args);
    this.write('TOOL_CALL', {
      runId,
      tool,
      args: safeArgs,
      success: result.success,
      error: result.error,
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
