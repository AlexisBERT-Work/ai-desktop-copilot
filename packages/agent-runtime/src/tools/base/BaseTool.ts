import type {
  ToolDefinition,
  ToolResult,
  ToolCategory,
  OllamaToolSchema,
  JSONSchemaObject,
} from '@catdesk/shared-types';
import type { RiskLevel } from '@catdesk/shared-types';
import type { RegisteredTool } from '../../ToolRegistry';

export abstract class BaseTool implements RegisteredTool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly category: ToolCategory;
  abstract readonly riskLevel: RiskLevel;
  abstract readonly requiresConfirmation: boolean;
  abstract readonly schema: JSONSchemaObject;

  abstract execute(args: unknown): Promise<ToolResult>;

  toOllamaSchema(): OllamaToolSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.schema,
      },
    };
  }

  protected ok(data: unknown, metadata?: Record<string, unknown>): ToolResult {
    return { success: true, data, ...(metadata !== undefined ? { metadata } : {}) };
  }

  protected fail(error: string, metadata?: Record<string, unknown>): ToolResult {
    return { success: false, error, ...(metadata !== undefined ? { metadata } : {}) };
  }
}
