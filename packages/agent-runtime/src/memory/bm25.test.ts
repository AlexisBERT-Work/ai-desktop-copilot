import { describe, it, expect } from 'vitest';
import { bm25Scores, tokenize } from './bm25';

const docs = [
  { id: 'a', content: 'Le projet CatDesk utilise Tauri et Rust pour le backend' },
  { id: 'b', content: 'pnpm est plus rapide que npm pour installer les dépendances' },
  { id: 'c', content: 'recette de tarte aux pommes maison' },
];

describe('bm25', () => {
  it('tokenizes, lowercases, drops short tokens', () => {
    expect(tokenize('Le Tauri, Rust!')).toEqual(['tauri', 'rust']);
  });

  it('ranks the doc containing the query terms first', () => {
    const s = bm25Scores('tauri rust', docs);
    expect(s.get('a')).toBeGreaterThan(0);
    expect(s.has('b')).toBe(false); // no query term → not scored
    expect(s.has('c')).toBe(false);
  });

  it('matches exact keywords/identifiers (where dense often fails)', () => {
    const s = bm25Scores('pnpm', docs);
    expect([...s.keys()]).toEqual(['b']);
  });

  it('returns empty when no term matches', () => {
    expect(bm25Scores('kubernetes orchestration', docs).size).toBe(0);
  });

  it('returns empty for an empty corpus or query', () => {
    expect(bm25Scores('tauri', []).size).toBe(0);
    expect(bm25Scores('', docs).size).toBe(0);
  });

  it('rewards rarer terms more (IDF)', () => {
    const corpus = [
      { id: '1', content: 'commun commun commun rare' },
      { id: '2', content: 'commun commun commun commun' },
      { id: '3', content: 'commun rien' },
    ];
    const s = bm25Scores('commun rare', corpus);
    // doc 1 has the rare term → should outscore doc 2 (only the common term)
    expect(s.get('1')!).toBeGreaterThan(s.get('2')!);
  });
});
