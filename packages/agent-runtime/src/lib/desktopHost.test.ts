import { describe, expect, it, vi } from 'vitest';
import { RPC_METHODS, RPC_NOTIFICATIONS, type JsonRpcRequest } from '@catdesk/shared-types';
import { DesktopHost } from './desktopHost';
import { ReadWindowTool } from '../tools/screen/ReadWindowTool';
import { WindowActionTool } from '../tools/screen/WindowActionTool';
import { StdinBridge } from '../ipc/StdinBridge';
import type { AgentOrchestrator } from '../AgentOrchestrator';
import { expectFail, expectOk } from '../tools/base/testResult';

/** Un hôte dont on capte les demandes, pour y répondre à la main. */
function capturedHost(timeoutMs = 1_000) {
  const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
  const host = new DesktopHost((method, params) => {
    sent.push({ method, params: params as Record<string, unknown> });
  }, timeoutMs);
  const lastId = (): string => String(sent.at(-1)?.params['requestId']);
  return { host, sent, lastId };
}

describe('DesktopHost — canal desktop.request / desktop.response', () => {
  it('émet la demande et la résout avec la réponse de même requestId', async () => {
    const { host, sent, lastId } = capturedHost();
    const pending = host.request('read_window', { window: 'Bloc-notes' });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe(RPC_NOTIFICATIONS.desktopRequest);
    expect(sent[0]?.params).toMatchObject({
      action: 'read_window',
      params: { window: 'Bloc-notes' },
    });

    host.resolve({ requestId: lastId(), ok: true, data: { elements: '1. bouton « OK »' } });
    await expect(pending).resolves.toEqual({ ok: true, data: { elements: '1. bouton « OK »' } });
  });

  it("relaie l'erreur de l'hôte telle quelle", async () => {
    const { host, lastId } = capturedHost();
    const pending = host.request('window_action', { window: 'x', action: 'close' });
    host.resolve({
      requestId: lastId(),
      ok: false,
      error: 'Aucune fenêtre ne correspond à « x ».',
    });
    await expect(pending).resolves.toEqual({
      ok: false,
      error: 'Aucune fenêtre ne correspond à « x ».',
    });
  });

  it('ne rejette jamais : sans hôte, échoue proprement au bout du délai', async () => {
    vi.useFakeTimers();
    try {
      const { host } = capturedHost(500);
      const pending = host.request('list_windows', {});
      await vi.advanceTimersByTimeAsync(500);
      const result = await pending;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/pas répondu/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignore une réponse inconnue, tardive ou mal formée', async () => {
    const { host, lastId } = capturedHost();
    const pending = host.request('list_windows', {});
    host.resolve({ requestId: 'autre', ok: true, data: 'intrus' });
    host.resolve('pas un objet');
    host.resolve({ ok: true });
    host.resolve({ requestId: lastId(), ok: true, data: 'la bonne' });
    host.resolve({ requestId: lastId(), ok: true, data: 'en double' });
    await expect(pending).resolves.toEqual({ ok: true, data: 'la bonne' });
  });

  it('deux demandes simultanées ne se mélangent pas', async () => {
    const { host, sent } = capturedHost();
    const a = host.request('read_window', { window: 'A' });
    const b = host.request('read_window', { window: 'B' });
    const [idA, idB] = sent.map(s => String(s.params['requestId']));
    expect(idA).not.toBe(idB);
    host.resolve({ requestId: idB, ok: true, data: 'B' });
    host.resolve({ requestId: idA, ok: true, data: 'A' });
    await expect(a).resolves.toEqual({ ok: true, data: 'A' });
    await expect(b).resolves.toEqual({ ok: true, data: 'B' });
  });
});

describe('read_window et window_action', () => {
  it('read_window sans fenêtre liste les fenêtres', async () => {
    const { host, sent, lastId } = capturedHost();
    const tool = new ReadWindowTool(() => host);
    const run = tool.run({ window: '  ' });
    await Promise.resolve();
    expect(sent[0]?.params).toMatchObject({ action: 'list_windows', params: {} });
    host.resolve({ requestId: lastId(), ok: true, data: { total: 0, fenetres: [] } });
    expect(expectOk(await run).data).toEqual({ total: 0, fenetres: [] });
  });

  it('read_window avec une fenêtre la lit (titre nettoyé)', async () => {
    const { host, sent, lastId } = capturedHost();
    const tool = new ReadWindowTool(() => host);
    const run = tool.run({ window: ' Bloc-notes ' });
    await Promise.resolve();
    expect(sent[0]?.params).toMatchObject({
      action: 'read_window',
      params: { window: 'Bloc-notes' },
    });
    host.resolve({ requestId: lastId(), ok: false, error: 'Aucune fenêtre ne correspond.' });
    expect(expectFail(await run).error).toMatch(/Aucune fenêtre/);
  });

  it('window_action transmet la fenêtre et une action de la liste fermée', async () => {
    const { host, sent, lastId } = capturedHost();
    const tool = new WindowActionTool(() => host);
    const run = tool.run({ window: 'Calculatrice', action: 'minimize' });
    await Promise.resolve();
    expect(sent[0]?.params).toMatchObject({
      action: 'window_action',
      params: { window: 'Calculatrice', action: 'minimize' },
    });
    host.resolve({ requestId: lastId(), ok: true, data: { action: 'minimize', fait: true } });
    expectOk(await run);
  });

  it('window_action refuse une action hors liste sans rien envoyer', async () => {
    const { host, sent } = capturedHost();
    const tool = new WindowActionTool(() => host);
    expectFail(await tool.run({ window: 'Calculatrice', action: 'kill' }));
    expectFail(await tool.run({ window: '', action: 'close' }));
    expect(sent).toHaveLength(0);
  });

  it('window_action est à confirmer, read_window non', () => {
    expect(new WindowActionTool().riskLevel).toBe('high');
    expect(new WindowActionTool().requiresConfirmation).toBe(true);
    expect(new ReadWindowTool().riskLevel).toBe('low');
  });
});

describe('StdinBridge — desktop.response', () => {
  it("relaie la réponse de l'hôte au DesktopHost", async () => {
    const resolveDesktop = vi.fn();
    const bridge = new StdinBridge({
      orchestrator: {} as unknown as AgentOrchestrator,
      resolveDesktop,
    });
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method: RPC_METHODS.desktopResponse,
      params: { requestId: 'r-1', ok: true, data: [] },
    };
    await (bridge as unknown as { handleRequest(r: JsonRpcRequest): Promise<void> }).handleRequest(
      request,
    );
    expect(resolveDesktop).toHaveBeenCalledWith({ requestId: 'r-1', ok: true, data: [] });
  });
});
