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
   * Schéma zod des arguments — source unique : le tool en dérive aussi son
   * JSON Schema via `schema = jsonSchemaFrom(argsSchema)` (plus d'interface
   * Args ni d'entrée TOOL_SCHEMAS à part). Obligatoire : la migration est
   * terminée, les 68 outils enregistrés en déclarent un.
   */
  abstract readonly argsSchema: z.ZodType<A, z.ZodTypeDef, unknown>;

  /**
   * Arguments qui désignent un chemin du disque à LIRE ou ÉCRIRE (chaîne ou
   * tableau de chaînes). Le moteur de permissions les vérifie contre la liste
   * blanche AVANT l'exécution : tout outil qui touche au disque doit les
   * déclarer — une clé oubliée ici est une lecture hors liste blanche (c'était
   * le cas de `vault` et `paths` quand le moteur ne regardait que `path`).
   * Une pathspec git, relative au dépôt `workdir`, n'en est pas une.
   */
  readonly pathArgs: readonly string[] = [];

  abstract execute(args: A): Promise<ToolResult>;

  /** Valeurs des `pathArgs` présentes dans des arguments bruts (avant validation). */
  filesystemTargets(args: Record<string, unknown>): string[] {
    const targets: string[] = [];
    for (const key of this.pathArgs) {
      const value = args[key];
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (typeof v === 'string' && v.length > 0) targets.push(v);
      }
    }
    return targets;
  }

  /**
   * Point d'entrée du registre : valide les arguments produits par le LLM
   * avant `execute()`. Des arguments invalides sont refusés avec un message
   * actionnable renvoyé au LLM plutôt que propagés dans le tool.
   */
  async run(rawArgs: unknown): Promise<ToolResult> {
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
