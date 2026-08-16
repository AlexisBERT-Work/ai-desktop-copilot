import { describe, expect, it } from 'vitest';
import { DEFAULT_PERMISSION_CONFIG } from '@catdesk/shared-types';
import { ToolRegistry } from '../ToolRegistry';
import {
  registerCoreTools,
  registerAutomationTools,
  RESEARCH_EXCLUDED,
  type ToolProfile,
} from './registerTools';
import { OllamaClient } from '../llm/OllamaClient';
import { VectorStore } from '../memory/VectorStore';
import { MarketService } from '../market/MarketService';
import type { SubAgentRunner } from '../SubAgentRunner';
import type { CronScheduler } from '../CronScheduler';
import { SkillStore } from '../skills/SkillStore';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Garde-fou anti-dérive : les métadonnées d'un outil vivent à deux endroits
 * (la classe *Tool.ts et DEFAULT_PERMISSION_CONFIG). Ce test échoue dès
 * qu'elles se désynchronisent — outil sans permission, permission orpheline,
 * ou riskLevel/requiresConfirmation divergents.
 */
function buildRegistry(profile: ToolProfile): ToolRegistry {
  const tools = new ToolRegistry();
  const llm = new OllamaClient({ baseUrl: 'http://127.0.0.1:1' });
  registerCoreTools(
    tools,
    {
      llm,
      vectorStore: new VectorStore(llm),
      market: new MarketService([]),
      // Dossier inexistant : le store dégrade proprement en catalogue vide, ce
      // qui suffit pour inspecter les métadonnées de load_skill.
      skills: new SkillStore(join(tmpdir(), 'catdesk-skills-absent')),
      localDailies: { list: () => [] },
      sharedDailies: { fetch: async () => ({ items: [] }) },
      defaultModel: 'test-model',
      visionModel: 'test-vision',
    },
    profile,
  );
  // Les constructeurs des outils d'automatisation ne font que stocker la
  // référence : des doubles vides suffisent pour inspecter les métadonnées.
  registerAutomationTools(tools, {} as SubAgentRunner, {} as CronScheduler);
  return tools;
}

describe('cohérence outils ↔ permissions', () => {
  const registry = buildRegistry('full');
  const registered = registry.getEnabled();
  const permissionNames = Object.keys(DEFAULT_PERMISSION_CONFIG.tools);

  it('enregistre bien les 69 outils', () => {
    expect(registered.length).toBe(69);
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

describe("profil 'research' (bot articles + recherche)", () => {
  const registry = buildRegistry('research');
  const names = new Set(registry.getEnabled().map(t => t.name));

  it('masque les outils dev/infra', () => {
    const leaked = [...RESEARCH_EXCLUDED].filter(n => names.has(n));
    expect(leaked).toEqual([]);
  });

  it('garde les outils recherche/presse essentiels', () => {
    for (const n of [
      'search_dailies',
      'read_webpage',
      'fetch_tech_news',
      'search_memory',
      'schedule_task',
      'run_subagent',
      // Brique du harness (divulgation progressive), pas une capacité métier :
      // load_skill doit rester exposé même sur le profil recentré.
      'load_skill',
    ]) {
      expect(names.has(n), n).toBe(true);
    }
  });

  it('compte : catalogue complet moins les exclusions', () => {
    expect(names.size).toBe(69 - RESEARCH_EXCLUDED.size);
  });
});
