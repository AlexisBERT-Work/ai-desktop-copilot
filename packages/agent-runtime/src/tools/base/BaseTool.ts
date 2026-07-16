import type {
  ToolResult,
  ToolCategory,
  OllamaToolSchema,
  JSONSchemaObject,
} from '@catdesk/shared-types';
import type { RiskLevel } from '@catdesk/shared-types';
import type { z } from 'zod';
import type { RegisteredTool } from '../../ToolRegistry';

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map(i => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join(' ; ');
}

export abstract class BaseTool<A = unknown> implements RegisteredTool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly category: ToolCategory;
  abstract readonly riskLevel: RiskLevel;
  abstract readonly requiresConfirmation: boolean;
  abstract readonly schema: JSONSchemaObject;

  /**
   * Schéma zod des arguments (opt-in, migration progressive) : quand il est
   * défini, `run()` valide les arguments produits par le LLM avant
   * `execute()`, et le tool définit `schema = jsonSchemaFrom(argsSchema)`
   * (source unique — plus d'interface Args ni d'entrée TOOL_SCHEMAS à part).
   */
  readonly argsSchema?: z.ZodType<A, z.ZodTypeDef, unknown>;

  abstract execute(args: A): Promise<ToolResult>;

  /**
   * Point d'entrée du registre. Sans `argsSchema`, comportement historique
   * (cast en confiance) ; avec, les arguments invalides sont refusés avec un
   * message actionnable renvoyé au LLM.
   */
  async run(rawArgs: unknown): Promise<ToolResult> {
    if (!this.argsSchema) {
      return this.execute(rawArgs as A);
    }
    const parsed = this.argsSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      return this.fail(`Arguments invalides: ${formatZodError(parsed.error)}`);
    }
    return this.execute(parsed.data);
  }

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
