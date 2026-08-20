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

  it('recentre la mission sur les articles et la recherche, pas le code', () => {
    const p = buildSystemPrompt({});
    expect(p).toContain('revues de presse quotidiennes (dailys)');
    expect(p).toContain('PAS un assistant de programmation');
    expect(p).toContain('search_dailies EN PREMIER');
    expect(p).toContain('cite le journal et la date');
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

  describe('skills (divulgation progressive)', () => {
    it("n'ajoute aucune section quand il n'y a pas de skill", () => {
      expect(buildSystemPrompt({})).not.toContain('Skills disponibles');
      expect(buildSystemPrompt({ skills: [] })).not.toContain('Skills disponibles');
    });

    it('annonce nom + description sans impératif bloquant', () => {
      const p = buildSystemPrompt({
        skills: [{ name: 'revue-presse', description: 'Question couvrant plusieurs journaux.' }],
      });
      expect(p).toContain('Procédures disponibles');
      expect(p).toContain('- revue-presse — Question couvrant plusieurs journaux.');
      expect(p).toContain('load_skill');
      // L'impératif « appelle X AVANT d'agir » faisait produire à qwen3:14b un
      // appel d'outil malformé → réponse vide (mesuré 2026-08-16). Ne pas le
      // réintroduire sans refaire le banc.
      expect(p).not.toContain("AVANT d'agir");
    });

    it("n'injecte JAMAIS le corps du skill (c'est tout l'intérêt)", () => {
      const p = buildSystemPrompt({
        skills: [{ name: 'revue-presse', description: 'Résumé court.' }],
      });
      // Le contexte est aussi rare que la VRAM : une régression ici ferait
      // payer chaque tour au prix du corps complet de tous les skills.
      expect(p.length).toBeLessThan(3000);
    });
  });
});
