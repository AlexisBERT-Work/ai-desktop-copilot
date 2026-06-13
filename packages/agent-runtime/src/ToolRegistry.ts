import type { ToolDefinition, ToolResult, OllamaToolSchema } from '@catdesk/shared-types';
import { createLogger } from './logger';

const log = createLogger('agent:tools');

// Tool interface that registry works with
export interface RegisteredTool extends ToolDefinition {
  execute(args: unknown): Promise<ToolResult>;
  toOllamaSchema(): OllamaToolSchema;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.name, tool);
    log.info('Tool registered', { name: tool.name, category: tool.category, risk: tool.riskLevel });
  }

  getEnabled(allowList?: string[]): RegisteredTool[] {
    const all = Array.from(this.tools.values());
    if (!allowList) return all;
    return all.filter(t => allowList.includes(t.name));
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, args: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool not found: ${name}` };
    }

    const startMs = Date.now();
    log.debug('Executing tool', { name, args });

    try {
      const result = await tool.execute(args);
      const durationMs = Date.now() - startMs;
      log.debug('Tool complete', { name, success: result.success, durationMs });
      return { ...result, metadata: { ...result.metadata, durationMs } };
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const error = err instanceof Error ? err.message : String(err);
      log.error('Tool failed', { name, error, durationMs });
      return { success: false, error, metadata: { durationMs } };
    }
  }
}
