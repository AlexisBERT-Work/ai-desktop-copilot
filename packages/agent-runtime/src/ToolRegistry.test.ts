import { describe, expect, it, vi } from 'vitest';
import type { ToolResult } from '@catdesk/shared-types';
import { ToolRegistry, type OutboundArgs, type RegisteredTool } from './ToolRegistry';

function fakeTool(prepare?: (args: Record<string, unknown>) => OutboundArgs) {
  const run = vi.fn(async (args: unknown): Promise<ToolResult> => ({ success: true, data: args }));
  const tool = {
    name: 'send',
    description: 'test',
    category: 'web',
    riskLevel: 'high',
    requiresConfirmation: true,
    schema: { type: 'object', properties: {} },
    execute: run,
    run,
    toOllamaSchema: () => ({
      type: 'function',
      function: { name: 'send', description: 'test', parameters: {} },
    }),
    filesystemTargets: () => [],
    ...(prepare ? { prepareOutboundArgs: prepare } : {}),
  } as unknown as RegisteredTool;
  return { tool, run };
}

describe('ToolRegistry — arguments sortants', () => {
  const mask = (args: Record<string, unknown>): OutboundArgs => ({
    args: { ...args, message: '[IBAN masqué]' },
    notice: 'Masqué avant envoi : 1 IBAN.',
  });

  it('outil sans crochet : arguments rendus tels quels', () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool().tool);
    const args = { message: 'x' };
    expect(registry.prepareOutboundArgs('send', args)).toEqual({ ok: true, args });
    expect(registry.prepareOutboundArgs('inconnu', args)).toEqual({ ok: true, args });
  });

  it('outil avec crochet : arguments masqués et notice', () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool(mask).tool);
    expect(registry.prepareOutboundArgs('send', { message: 'FR76…' })).toEqual({
      ok: true,
      args: { message: '[IBAN masqué]' },
      notice: 'Masqué avant envoi : 1 IBAN.',
    });
  });

  it('execute masque toujours, quel que soit l’appelant', async () => {
    const registry = new ToolRegistry();
    const { tool, run } = fakeTool(mask);
    registry.register(tool);
    await registry.execute('send', { message: 'FR7630006000011234567890189' });
    expect(run).toHaveBeenCalledWith({ message: '[IBAN masqué]' });
  });

  it('crochet qui plante : rien n’est envoyé', async () => {
    const registry = new ToolRegistry();
    const { tool, run } = fakeTool(() => {
      throw new Error('boum');
    });
    registry.register(tool);
    expect(registry.prepareOutboundArgs('send', {})).toEqual({
      ok: false,
      error: 'Masquage des données personnelles impossible : boum',
    });
    const result = await registry.execute('send', { message: 'x' });
    expect(result).toEqual({
      success: false,
      error: 'Masquage des données personnelles impossible : boum',
    });
    expect(run).not.toHaveBeenCalled();
  });
});
