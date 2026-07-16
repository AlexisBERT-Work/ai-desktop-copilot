import { describe, expect, it } from 'vitest';
import { buildStepNotification } from './StdinBridge';

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
