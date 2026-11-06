import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BaseTool } from '../tools/base/BaseTool';
import { jsonSchemaFrom } from '../tools/base/zodSchema';
import type { ToolResult } from '@catdesk/shared-types';
import { buildSimulatedRegistry, SimulatedToolRegistry } from './SimulatedToolRegistry';
import { CALENDAR_PATH, simulatedWorld } from './simulatedWorld';

const argsSchema = z.object({ path: z.string().min(1) });

class DangerousTool extends BaseTool<z.infer<typeof argsSchema>> {
  readonly name = 'dangerous';
  readonly description = 'Efface tout';
  readonly category = 'system' as const;
  readonly riskLevel = 'high' as const;
  readonly requiresConfirmation = true;
  readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);
  executed = 0;

  async execute(): Promise<ToolResult> {
    this.executed++;
    return this.ok('effacé');
  }
}

function setup(world = {}): { registry: SimulatedToolRegistry; tool: DangerousTool } {
  const registry = new SimulatedToolRegistry(world);
  const tool = new DangerousTool();
  registry.register(tool);
  return { registry, tool };
}

describe('SimulatedToolRegistry', () => {
  it("n'exécute jamais le vrai outil", async () => {
    const { registry, tool } = setup();
    await registry.execute('dangerous', { path: 'C:/' });
    expect(tool.executed).toBe(0);
  });

  it('rend la réponse du monde simulé, avec les arguments validés', async () => {
    const { registry } = setup({
      dangerous: (args: Record<string, unknown>) => ({ success: true, data: args['path'] }),
    });
    await expect(registry.execute('dangerous', { path: 'C:/a' })).resolves.toEqual({
      success: true,
      data: 'C:/a',
    });
  });

  it('sans réponse prévue, simule un succès neutre', async () => {
    const { registry } = setup();
    await expect(registry.execute('dangerous', { path: 'C:/' })).resolves.toEqual({
      success: true,
      data: { ok: true },
    });
  });

  it('applique le vrai schéma : des arguments invalides sont refusés et notés', async () => {
    const { registry } = setup();
    const result = await registry.execute('dangerous', {});
    expect(result.success).toBe(false);
    expect(registry.takeCalls()).toEqual([{ name: 'dangerous', args: {}, valid: false }]);
  });

  it('un outil inconnu échoue sans lever', async () => {
    const { registry } = setup();
    await expect(registry.execute('inconnu', {})).resolves.toMatchObject({ success: false });
  });

  it('takeCalls rend les appels une seule fois', async () => {
    const { registry } = setup();
    await registry.execute('dangerous', { path: 'a' });
    expect(registry.takeCalls()).toHaveLength(1);
    expect(registry.takeCalls()).toEqual([]);
  });
});

describe('buildSimulatedRegistry', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  const registry = buildSimulatedRegistry(simulatedWorld(now));

  it('expose le catalogue réel du profil research', () => {
    const names = registry.listNames();
    expect(names).toContain('read_email');
    expect(names).toContain('run_command');
    expect(names).not.toContain('docker_control');
  });

  it("refuse un calendrier inventé, comme le vrai outil : aucun chemin n'est configuré", async () => {
    const result = await registry.execute('read_calendar', { path: 'C:/Users/moi/agenda.ics' });
    expect(result).toMatchObject({ success: false });
  });

  it('sert le calendrier du monde, quelle que soit la forme du chemin', async () => {
    const windowsPath = CALENDAR_PATH.replace(/\//g, '\\');
    const result = await registry.execute('read_calendar', { path: windowsPath });
    expect(result).toMatchObject({ success: true });
  });

  it('place le rendez-vous de demain sur le lendemain du run', () => {
    const calendar = simulatedWorld(now)['read_calendar']?.({ path: CALENDAR_PATH });
    expect(JSON.stringify(calendar)).toContain('2026-11-06T14:30:00');
  });
});
