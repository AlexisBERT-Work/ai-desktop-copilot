import type { ToolResult } from '@catdesk/shared-types';
import type { z } from 'zod';
import { ToolRegistry, type RegisteredTool } from '../ToolRegistry';
import { CONFIG } from '../config';
import { OllamaClient } from '../llm/OllamaClient';
import { MarketService } from '../market/MarketService';
import { VectorStore } from '../memory/VectorStore';
import { SkillStore } from '../skills/SkillStore';
import { BaseTool, formatZodError } from '../tools/base/BaseTool';
import { registerAutomationTools, registerCoreTools } from '../tools/registerTools';
import type { CronScheduler } from '../CronScheduler';
import type { SubAgentRunner } from '../SubAgentRunner';
import type { SimulatedWorld } from './simulatedWorld';

export interface SimulatedCall {
  name: string;
  args: unknown;
  /** Les arguments passent-ils le vrai schéma zod de l'outil ? */
  valid: boolean;
}

/**
 * Registre du banc : les VRAIS outils pour ce que le modèle voit (nom,
 * description, schéma, sélection), mais aucune exécution réelle. `execute` ne
 * passe jamais par `tool.run` : un banc ne doit ni lire les mails, ni lancer de
 * commande, ni poster sur Discord.
 */
export class SimulatedToolRegistry extends ToolRegistry {
  private readonly schemas = new Map<string, z.ZodType<unknown, unknown>>();
  private calls: SimulatedCall[] = [];

  constructor(private readonly world: SimulatedWorld) {
    super();
  }

  override register(tool: RegisteredTool): void {
    super.register(tool);
    if (tool instanceof BaseTool) {
      this.schemas.set(tool.name, tool.argsSchema as z.ZodType<unknown, unknown>);
    }
  }

  override async execute(name: string, args: unknown): Promise<ToolResult> {
    const schema = this.schemas.get(name);
    if (!schema) {
      this.calls.push({ name, args, valid: false });
      return { success: false, error: `Tool not found: ${name}` };
    }

    const parsed = schema.safeParse(args ?? {});
    this.calls.push({ name, args, valid: parsed.success });
    if (!parsed.success) {
      return { success: false, error: `Arguments invalides: ${formatZodError(parsed.error)}` };
    }

    const respond = this.world[name];
    return respond
      ? respond(parsed.data as Record<string, unknown>)
      : { success: true, data: { ok: true } };
  }

  /** Rend les appels enregistrés depuis le dernier relevé, et remet le compteur à zéro. */
  takeCalls(): SimulatedCall[] {
    const calls = this.calls;
    this.calls = [];
    return calls;
  }
}

/** Le catalogue réel du profil courant, branché sur le monde simulé. */
export function buildSimulatedRegistry(world: SimulatedWorld): SimulatedToolRegistry {
  const registry = new SimulatedToolRegistry(world);
  // Jamais joint : seuls les constructeurs des outils en ont besoin.
  const llm = new OllamaClient({ baseUrl: 'http://127.0.0.1:1' });
  registerCoreTools(
    registry,
    {
      llm,
      vectorStore: new VectorStore(llm),
      market: new MarketService([]),
      skills: new SkillStore('banc-sans-skills'),
      localDailies: { list: () => [] },
      sharedDailies: { fetch: async () => ({ items: [] }) },
      defaultModel: 'banc',
      visionModel: 'banc',
    },
    CONFIG.toolProfile,
  );
  // Doubles vides : ces constructeurs ne font que stocker la référence, et
  // `execute` ci-dessus empêche tout appel.
  registerAutomationTools(registry, {} as SubAgentRunner, {} as CronScheduler);
  return registry;
}
