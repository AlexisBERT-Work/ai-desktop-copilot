import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './systemPrompt';

describe('buildSystemPrompt', () => {
  it("contient l'identité, les règles et le guidage d'outils", () => {
    const p = buildSystemPrompt({});
    expect(p).toContain('Tu es CatDesk');
    expect(p).toContain('Règles importantes');
    expect(p).toContain('run_subagent UNIQUEMENT');
    expect(p).toContain('Réponds TOUJOURS en français');
  });

  it('numérote le plan et intègre le contexte fourni', () => {
    const p = buildSystemPrompt(
      {
        activeWindow: 'VS Code',
        conversationSummary: 'résumé X',
        warmFacts: ['préfère TypeScript'],
        relevantMemories: ['souvenir A'],
        playbookHint: 'stratégie gagnante Y',
      },
      ['ouvrir le fichier', 'corriger le bug'],
    );
    expect(p).toContain('1. ouvrir le fichier');
    expect(p).toContain('2. corriger le bug');
    expect(p).toContain('Fenêtre active : VS Code');
    expect(p).toContain('résumé X');
    expect(p).toContain('préfère TypeScript');
    expect(p).toContain('souvenir A');
    expect(p).toContain('stratégie gagnante Y');
  });

  it('tronque le texte écran à 1500 caractères', () => {
    const p = buildSystemPrompt({ screenText: 'x'.repeat(5000) });
    const section = p.split("Contenu visible à l'écran :\n")[1]?.split('\n')[0] ?? '';
    expect(section.length).toBe(1500);
  });
});
