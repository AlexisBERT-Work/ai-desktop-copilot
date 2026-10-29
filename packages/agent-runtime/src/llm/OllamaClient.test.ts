import { describe, expect, it } from 'vitest';
import { parseChatLine } from './OllamaClient';

describe('parseChatLine — flux NDJSON de /api/chat', () => {
  it('un token de contenu', () => {
    expect(parseChatLine('{"message":{"content":"Bon"},"done":false}')).toEqual([
      { type: 'token', content: 'Bon' },
    ]);
  });

  it('la ligne finale porte done + le nombre de tokens', () => {
    expect(parseChatLine('{"message":{"content":""},"done":true,"eval_count":42}')).toEqual([
      { type: 'done', totalTokens: 42 },
    ]);
  });

  it('un tool call garde ses arguments en OBJET (pas d’aller-retour en chaîne)', () => {
    const [chunk] = parseChatLine(
      '{"message":{"content":"","tool_calls":[{"function":{"name":"echo","arguments":{"x":1}}}]}}',
    );
    expect(chunk).toMatchObject({
      type: 'tool_call',
      toolCall: { type: 'function', function: { name: 'echo', arguments: { x: 1 } } },
    });
    expect(chunk?.type === 'tool_call' && chunk.toolCall.id.length > 0).toBe(true);
  });

  it('des arguments absents ou de type inattendu deviennent {}', () => {
    const [chunk] = parseChatLine(
      '{"message":{"tool_calls":[{"id":"c1","function":{"name":"echo","arguments":null}}]}}',
    );
    expect(chunk).toMatchObject({ toolCall: { id: 'c1', function: { arguments: {} } } });
  });

  it('ligne vide ou illisible : rien, sans lever', () => {
    expect(parseChatLine('')).toEqual([]);
    expect(parseChatLine('   ')).toEqual([]);
    expect(parseChatLine('{"message":{"cont')).toEqual([]);
  });
});
