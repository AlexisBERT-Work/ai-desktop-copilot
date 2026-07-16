import { describe, expect, it } from 'vitest';
import { DEFAULT_PERMISSION_CONFIG } from '@catdesk/shared-types';
import { ToolRegistry } from '../ToolRegistry';
import { registerCoreTools, registerAutomationTools } from './registerTools';
import { OllamaClient } from '../llm/OllamaClient';
import { VectorStore } from '../memory/VectorStore';
import { MarketService } from '../market/MarketService';
import type { SubAgentRunner } from '../SubAgentRunner';
import type { CronScheduler } from '../CronScheduler';

/**
 * Garde-fou anti-dérive : les métadonnées d'un outil vivent à deux endroits
 * (la classe *Tool.ts et DEFAULT_PERMISSION_CONFIG). Ce test échoue dès
 * qu'elles se désynchronisent — outil sans permission, permission orpheline,
 * ou riskLevel/requiresConfirmation divergents.
 */
function buildFullRegistry(): ToolRegistry {
  const tools = new ToolRegistry();
  const llm = new OllamaClient({ baseUrl: 'http://127.0.0.1:1' });
  registerCoreTools(tools, {
    llm,
    vectorStore: new VectorStore(llm),
    market: new MarketService([]),
    defaultModel: 'test-model',
    visionModel: 'test-vision',
  });
  // Les constructeurs des outils d'automatisation ne font que stocker la
  // référence : des doubles vides suffisent pour inspecter les métadonnées.
  registerAutomationTools(tools, {} as SubAgentRunner, {} as CronScheduler);
  return tools;
}

describe('cohérence outils ↔ permissions', () => {
  const registry = buildFullRegistry();
  const registered = registry.getEnabled();
  const permissionNames = Object.keys(DEFAULT_PERMISSION_CONFIG.tools);

  it('enregistre bien les 67 outils', () => {
    expect(registered.length).toBe(67);
  });

  it('chaque outil enregistré a une entrée de permission', () => {
    const missing = registered.map(t => t.name).filter(name => !permissionNames.includes(name));
    expect(missing).toEqual([]);
  });

  it("chaque entrée de permission correspond à un outil enregistré (pas d'orphelin)", () => {
    const registeredNames = new Set(registered.map(t => t.name));
    const orphans = permissionNames.filter(name => !registeredNames.has(name));
    expect(orphans).toEqual([]);
  });

  it('riskLevel et requiresConfirmation concordent entre outil et permission', () => {
    const mismatches: string[] = [];
    for (const tool of registered) {
      const perm = DEFAULT_PERMISSION_CONFIG.tools[tool.name];
      if (!perm) continue; // couvert par le test précédent
      if (perm.riskLevel !== tool.riskLevel) {
        mismatches.push(
          `${tool.name}: riskLevel outil=${tool.riskLevel} permission=${perm.riskLevel}`,
        );
      }
      if (perm.requiresConfirmation !== tool.requiresConfirmation) {
        mismatches.push(
          `${tool.name}: requiresConfirmation outil=${tool.requiresConfirmation} permission=${perm.requiresConfirmation}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("chaque outil expose un schéma d'arguments non vide", () => {
    const empty = registered
      .filter(t => !t.schema || Object.keys(t.schema).length === 0)
      .map(t => t.name);
    expect(empty).toEqual([]);
  });
});
