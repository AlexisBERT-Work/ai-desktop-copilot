import { describe, expect, it, vi } from 'vitest';
import type { JsonRpcRequest } from '@catdesk/shared-types';
import { RPC_METHODS, RPC_NOTIFICATIONS } from '@catdesk/shared-types';
import { StdinBridge, buildStepNotification, parseSelectionTransformParams } from './StdinBridge';
import type { AgentOrchestrator } from '../AgentOrchestrator';

/**
 * Accès au dispatch privé : c'est LUI qui doit être couvert. La régression que
 * ces tests gardent (permission.response sans case → dialogue jamais résolu)
 * était invisible depuis les helpers purs testés plus bas.
 */
function dispatch(bridge: StdinBridge, request: JsonRpcRequest): Promise<void> {
  return (bridge as unknown as { handleRequest(r: JsonRpcRequest): Promise<void> }).handleRequest(
    request,
  );
}

describe('handleRequest — routage des méthodes du contrat', () => {
  it('permission.response débloque la demande en attente', async () => {
    const resolvePermission = vi.fn();
    const bridge = new StdinBridge({
      orchestrator: { resolvePermission } as unknown as AgentOrchestrator,
    });

    // Rust l'émet en NOTIFICATION : pas d'`id`.
    await dispatch(bridge, {
      jsonrpc: '2.0',
      method: RPC_METHODS.permissionResponse,
      params: { requestId: 'req-9', granted: true, remember: true },
    });

    expect(resolvePermission).toHaveBeenCalledWith('req-9', true, true);
  });

  it('permission.response mal formée est ignorée, pas propagée', async () => {
    const resolvePermission = vi.fn();
    const bridge = new StdinBridge({
      orchestrator: { resolvePermission } as unknown as AgentOrchestrator,
    });

    await dispatch(bridge, {
      jsonrpc: '2.0',
      method: RPC_METHODS.permissionResponse,
      params: { requestId: 42, granted: 'oui' },
    });

    expect(resolvePermission).not.toHaveBeenCalled();
  });

  it('une notification inconnue ne reçoit aucune réponse sur stdout', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      const bridge = new StdinBridge({ orchestrator: {} as unknown as AgentOrchestrator });
      await dispatch(bridge, {
        jsonrpc: '2.0',
        method: 'methode.inexistante' as never,
        params: {},
      });
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });

  it('une requête inconnue (avec id) reçoit bien -32601', async () => {
    const written: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
      written.push(String(chunk));
      return true;
    });
    try {
      const bridge = new StdinBridge({ orchestrator: {} as unknown as AgentOrchestrator });
      await dispatch(bridge, {
        jsonrpc: '2.0',
        id: 7,
        method: 'methode.inexistante' as never,
        params: {},
      });
    } finally {
      write.mockRestore();
    }
    expect(written).toHaveLength(1);
    const parsed = JSON.parse(written[0] as string) as { id: number; error: { code: number } };
    expect(parsed.id).toBe(7);
    expect(parsed.error.code).toBe(-32601);
  });
});

describe('buildStepNotification — invariant de corrélation UI', () => {
  it('porte toujours conversationId et messageId', () => {
    const out = buildStepNotification('req-1', { type: 'token', content: 'x' }, 'conv-42', 'msg-7');
    expect(out.step['conversationId']).toBe('conv-42');
    expect(out.step['messageId']).toBe('msg-7');
    expect(out.step['type']).toBe('token');
    expect(out.id).toBe('req-1');
  });

  it('messageId absent → chaîne vide explicite, jamais une valeur inventée', () => {
    const out = buildStepNotification(3, { type: 'done' }, 'conv-1', undefined);
    expect(out.step['messageId']).toBe('');
  });

  it('ne laisse pas le step écraser les ids de la requête', () => {
    const out = buildStepNotification(
      1,
      { conversationId: 'autre', messageId: 'autre' },
      'conv-A',
      'msg-B',
    );
    expect(out.step['conversationId']).toBe('conv-A');
    expect(out.step['messageId']).toBe('msg-B');
  });
});

describe('settings.update — sécurité', () => {
  const run = async (params: Record<string, unknown>) => {
    const updatePermissions = vi.fn();
    const setBrowserReadOnly = vi.fn();
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      const bridge = new StdinBridge({
        orchestrator: { updatePermissions } as unknown as AgentOrchestrator,
        setBrowserReadOnly,
      });
      await dispatch(bridge, { jsonrpc: '2.0', id: 1, method: RPC_METHODS.settingsUpdate, params });
    } finally {
      write.mockRestore();
    }
    return { updatePermissions, setBrowserReadOnly };
  };

  it('applique les deux réglages, qui voyagent ensemble', async () => {
    const { updatePermissions, setBrowserReadOnly } = await run({
      safeMode: true,
      browserReadOnly: false,
    });
    expect(updatePermissions).toHaveBeenCalledWith({ safeMode: true });
    expect(setBrowserReadOnly).toHaveBeenCalledWith(false);
  });

  it('une valeur absente ou mal typée ne change rien', async () => {
    const { updatePermissions, setBrowserReadOnly } = await run({ browserReadOnly: 'non' });
    expect(updatePermissions).toHaveBeenCalledWith({});
    expect(setBrowserReadOnly).not.toHaveBeenCalled();
  });
});

describe('selection.transform — texte sélectionné', () => {
  const params = {
    requestId: 'sel-1',
    text: 'Je suis la.',
    instruction: 'corrige',
    model: 'qwen3:14b',
  };

  const run = async (
    transformSelection: (...args: unknown[]) => Promise<unknown>,
    sent: Record<string, unknown> = params,
  ) => {
    const notify = vi.fn();
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      const bridge = new StdinBridge({
        orchestrator: { transformSelection } as unknown as AgentOrchestrator,
        notify,
      });
      await dispatch(bridge, {
        jsonrpc: '2.0',
        id: 1,
        method: RPC_METHODS.selectionTransform,
        params: sent,
      });
    } finally {
      write.mockRestore();
    }
    return notify;
  };

  it('rend le résultat en notification, corrélé par requestId', async () => {
    const transform = vi.fn(async () => ({ ok: true, text: 'Je suis là.' }));
    const notify = await run(transform);
    expect(transform).toHaveBeenCalledWith(
      'Je suis la.',
      'corrige',
      'qwen3:14b',
      expect.any(AbortSignal),
    );
    expect(notify).toHaveBeenCalledWith(RPC_NOTIFICATIONS.selectionResult, {
      requestId: 'sel-1',
      ok: true,
      text: 'Je suis là.',
    });
  });

  it("relaie l'échec tel quel", async () => {
    const notify = await run(async () => ({ ok: false, error: 'Consigne vide.' }));
    expect(notify).toHaveBeenCalledWith(RPC_NOTIFICATIONS.selectionResult, {
      requestId: 'sel-1',
      ok: false,
      error: 'Consigne vide.',
    });
  });

  it('des paramètres invalides ne lancent rien', async () => {
    const transform = vi.fn();
    const notify = await run(transform, { ...params, model: ' ' });
    expect(transform).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('selection.cancel interrompt la transformation en cours', async () => {
    let seen: AbortSignal | undefined;
    const notify = vi.fn();
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      const bridge = new StdinBridge({
        orchestrator: {
          transformSelection: (_t: string, _i: string, _m: string, signal: AbortSignal) =>
            new Promise(resolve => {
              seen = signal;
              signal.addEventListener('abort', () =>
                resolve({ ok: false, error: 'Transformation annulée.' }),
              );
            }),
        } as unknown as AgentOrchestrator,
        notify,
      });
      const pending = dispatch(bridge, {
        jsonrpc: '2.0',
        id: 1,
        method: RPC_METHODS.selectionTransform,
        params,
      });
      await dispatch(bridge, {
        jsonrpc: '2.0',
        id: 2,
        method: RPC_METHODS.selectionCancel,
        params: {},
      });
      await pending;
    } finally {
      write.mockRestore();
    }
    expect(seen?.aborted).toBe(true);
    expect(notify).toHaveBeenCalledWith(RPC_NOTIFICATIONS.selectionResult, {
      requestId: 'sel-1',
      ok: false,
      error: 'Transformation annulée.',
    });
  });
});

describe('parseSelectionTransformParams', () => {
  it('exige les quatre champs en chaînes, requestId et modèle non vides', () => {
    const ok = { requestId: 'r', text: '', instruction: '', model: 'm' };
    expect(parseSelectionTransformParams(ok)).toEqual(ok);
    expect(parseSelectionTransformParams({ ...ok, requestId: '' })).toBeNull();
    expect(parseSelectionTransformParams({ ...ok, text: 3 })).toBeNull();
    expect(parseSelectionTransformParams(null)).toBeNull();
  });
});
