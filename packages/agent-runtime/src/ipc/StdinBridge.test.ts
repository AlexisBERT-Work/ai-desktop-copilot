import { describe, expect, it, vi } from 'vitest';
import type { JsonRpcRequest } from '@catdesk/shared-types';
import { RPC_METHODS } from '@catdesk/shared-types';
import { StdinBridge, buildStepNotification } from './StdinBridge';
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
    const bridge = new StdinBridge({ resolvePermission } as unknown as AgentOrchestrator);

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
    const bridge = new StdinBridge({ resolvePermission } as unknown as AgentOrchestrator);

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
      const bridge = new StdinBridge({} as unknown as AgentOrchestrator);
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
      const bridge = new StdinBridge({} as unknown as AgentOrchestrator);
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
