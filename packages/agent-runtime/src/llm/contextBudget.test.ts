import { describe, expect, it } from 'vitest';
import {
  CHARS_PER_TOKEN,
  contextUsage,
  messagesTokens,
  overflowNotice,
  textTokens,
} from './contextBudget';

describe('estimation', () => {
  it('un token par chiffre, les blancs gratuits, le reste à CHARS_PER_TOKEN', () => {
    expect(textTokens('')).toBe(0);
    expect(textTokens('1234567890')).toBe(10);
    expect(textTokens(' \n\t'.repeat(50))).toBe(0);
    expect(textTokens('a'.repeat(270))).toBe(Math.ceil(270 / CHARS_PER_TOKEN));
  });

  it('les espaces d’alignement d’un tableau markdown ne comptent pas', () => {
    const cell = 'outil';
    const padded = `| ${cell}${' '.repeat(40)}|`;
    expect(textTokens(padded)).toBe(textTokens(`|${cell}|`));
  });

  it('une sortie chiffrée coûte plus qu’une sortie en texte de même longueur', () => {
    const numbers = JSON.stringify({ open: 187.4523, close: 186.1234, volume: 51234567 });
    const words = JSON.stringify({ open: 'ouverture', close: 'clôture', volume: 'échangés' });
    expect(textTokens(numbers) / numbers.length).toBeGreaterThan(textTokens(words) / words.length);
  });

  it('compte le contenu, les balises de chaque message et les tool calls rejoués', () => {
    const plain = messagesTokens([{ role: 'user', content: 'abc' }]);
    const withCall = messagesTokens([
      { role: 'user', content: 'abc' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: '1', type: 'function', function: { name: 'echo', arguments: {} } }],
      },
    ]);
    expect(plain).toBeGreaterThan(textTokens('abc'));
    expect(withCall).toBeGreaterThan(plain + 5);
  });
});

describe('contextUsage', () => {
  it('fait confiance au compteur quand le prompt tient, même servi par le cache', () => {
    expect(contextUsage({ estimated: 2300, promptEvalCount: 2096, numCtx: 8192 })).toEqual({
      tokens: 2096,
      overflow: false,
    });
  });

  it('un long texte anglais qui tient ne déclenche rien (surestimé jusqu’à 1,5 fois)', () => {
    expect(contextUsage({ estimated: 7900, promptEvalCount: 5300, numCtx: 8192 }).overflow).toBe(
      false,
    );
  });

  it('un compteur tombé à la moitié de la fenêtre trahit une coupe (mesuré : 4 098 pour 8 192)', () => {
    expect(contextUsage({ estimated: 9700, promptEvalCount: 4098, numCtx: 8192 })).toEqual({
      tokens: 9700,
      overflow: true,
    });
  });

  it('une fenêtre pleine au token près est une coupe', () => {
    expect(contextUsage({ estimated: 3000, promptEvalCount: 8192, numCtx: 8192 })).toEqual({
      tokens: 8192,
      overflow: true,
    });
  });

  it('un petit prompt avec un petit compteur n’est pas une coupe', () => {
    expect(contextUsage({ estimated: 1500, promptEvalCount: 600, numCtx: 8192 }).overflow).toBe(
      false,
    );
  });

  it('sans compteur, l’estimation seule décide', () => {
    expect(contextUsage({ estimated: 9000, numCtx: 8192 })).toEqual({
      tokens: 9000,
      overflow: true,
    });
    expect(contextUsage({ estimated: 5000, numCtx: 8192 }).overflow).toBe(false);
  });
});

describe('overflowNotice', () => {
  it('donne les deux tailles', () => {
    expect(overflowNotice(9100, 8192)).toContain('environ 9100 tokens pour 8192');
  });
});
