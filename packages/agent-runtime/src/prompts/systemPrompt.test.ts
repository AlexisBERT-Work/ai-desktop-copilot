import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, buildTurnContext, withTurnContext } from './systemPrompt';

describe('buildSystemPrompt', () => {
  it("contient l'identité, les règles et le guidage d'outils", () => {
    const p = buildSystemPrompt();
    expect(p).toContain('Tu es CatDesk');
    expect(p).toContain('Règles importantes');
    expect(p).toContain('run_subagent UNIQUEMENT');
    expect(p).toContain('Réponds TOUJOURS en français');
  });

  it('recentre la mission sur les articles et la recherche, pas le code', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('revues de presse quotidiennes (dailys)');
    expect(p).toContain('PAS un assistant de programmation');
    expect(p).toContain('search_dailies EN PREMIER');
    expect(p).toContain('cite le journal et la date');
  });

  it("est STABLE : identique d'un appel à l'autre, sans heure ni contexte du tour", () => {
    // La moindre variation en tête du prompt fait relire tout le cache d'Ollama.
    expect(buildSystemPrompt()).toBe(buildSystemPrompt());
    expect(buildSystemPrompt()).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('place la mémoire long terme en DERNIER (le début reste en cache)', () => {
    const base = buildSystemPrompt();
    const withFacts = buildSystemPrompt(['- préfère TypeScript']);
    expect(withFacts.startsWith(base)).toBe(true);
    expect(withFacts).toContain('préfère TypeScript');
  });
});

describe('buildTurnContext', () => {
  const now = new Date(2026, 9, 8, 9, 30, 42);

  it('donne la date à la minute, jamais à la seconde', () => {
    const c = buildTurnContext({}, [], now);
    expect(c).toContain('2026');
    expect(c).toContain('09:30');
    expect(c).not.toContain('42');
  });

  it('numérote le plan et intègre le contexte fourni', () => {
    const c = buildTurnContext(
      {
        activeWindow: 'VS Code',
        conversationSummary: 'résumé X',
        relevantMemories: ['souvenir A'],
        playbookHint: 'stratégie gagnante Y',
      },
      ['ouvrir le fichier', 'corriger le bug'],
      now,
    );
    expect(c).toContain('1. ouvrir le fichier');
    expect(c).toContain('2. corriger le bug');
    expect(c).toContain('Fenêtre active : VS Code');
    expect(c).toContain('résumé X');
    expect(c).toContain('souvenir A');
    expect(c).toContain('stratégie gagnante Y');
  });

  it('tronque le texte écran à 1500 caractères', () => {
    const c = buildTurnContext({ screenText: 'x'.repeat(5000) }, [], now);
    const section = c.split("Contenu visible à l'écran :\n")[1]?.split('\n')[0] ?? '';
    expect(section.length).toBe(1500);
  });

  it('withTurnContext met le contexte avant la demande, la demande intacte', () => {
    const m = withTurnContext('Quelle est la une du Monde ?', 'Date et heure actuelles : x');
    expect(m.indexOf('[Contexte]')).toBe(0);
    expect(m.endsWith('Quelle est la une du Monde ?')).toBe(true);
  });
});
