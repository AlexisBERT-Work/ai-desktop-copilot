import type { ToolDefinition, ToolResult, OllamaToolSchema } from '@catdesk/shared-types';
import { createLogger } from './logger';

const log = createLogger('agent:tools');

// Tool interface that registry works with
export interface RegisteredTool extends ToolDefinition {
  execute(args: unknown): Promise<ToolResult>;
  /** Valide (zod, si l'outil en a un) puis exécute — le chemin du LLM. */
  run(rawArgs: unknown): Promise<ToolResult>;
  toOllamaSchema(): OllamaToolSchema;
  /** Chemins du disque visés par ces arguments (voir BaseTool.pathArgs). */
  filesystemTargets(args: Record<string, unknown>): string[];
  /**
   * Outils qui envoient du texte HORS du poste (webhook, Discord, API) :
   * masque les données personnelles des arguments bruts (security/personalData).
   * Pur et idempotent : appelé avant le dialogue de confirmation, puis de
   * nouveau par `execute`, qui ne laisse ainsi rien partir en clair.
   */
  prepareOutboundArgs?(args: Record<string, unknown>): OutboundArgs;
}

/** Arguments prêts à sortir, et ce qu'il faut en dire à l'utilisateur. */
export interface OutboundArgs {
  args: Record<string, unknown>;
  /** Ce qui a été masqué, est à vérifier ou part tel quel (dialogue et résultat). */
  notice?: string;
}

/** Le masquage a planté : on n'envoie rien plutôt que d'envoyer en clair. */
export type OutboundPreparation = (OutboundArgs & { ok: true }) | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

  /** Chemins à vérifier contre la liste blanche avant d'exécuter `name`. */
  filesystemTargets(name: string, args: Record<string, unknown>): string[] {
    return this.tools.get(name)?.filesystemTargets(args) ?? [];
  }

  /**
   * Arguments de `name` une fois les données personnelles masquées. Un outil
   * sans crochet (tout ce qui ne sort pas du poste) les rend tels quels.
   */
  prepareOutboundArgs(name: string, args: Record<string, unknown>): OutboundPreparation {
    const tool = this.tools.get(name);
    if (!tool?.prepareOutboundArgs) return { ok: true, args };
    try {
      return { ok: true, ...tool.prepareOutboundArgs(args) };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error('Outbound masking failed', { name, error });
      return { ok: false, error: `Masquage des données personnelles impossible : ${error}` };
    }
  }

  async execute(name: string, args: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool not found: ${name}` };
    }

    // Filet : quel que soit l'appelant, rien ne sort sans être passé au masque.
    let runArgs = args;
    if (isRecord(args)) {
      const prepared = this.prepareOutboundArgs(name, args);
      if (!prepared.ok) return { success: false, error: prepared.error };
      runArgs = prepared.args;
    }

    const startMs = Date.now();
    log.debug('Executing tool', { name, args: runArgs });

    try {
      const result = await tool.run(runArgs);
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
