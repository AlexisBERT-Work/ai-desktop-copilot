import { describe, it, expect } from 'vitest';
import { ModelRouter, resolveModel } from './ModelRouter';

const router = new ModelRouter({ small: 'small-model', large: 'large-model' });

describe('ModelRouter', () => {
  it('rétrograde vers le petit modèle pour une tâche simple et courte', () => {
    const d = router.route({ prompt: 'bonjour', usesTools: false });
    expect(d.model).toBe('small-model');
    expect(d.tier).toBe('small');
  });

  it("n'escalade PAS sur la simple présence d'outils (une tâche triviale reste petite)", () => {
    const d = router.route({ prompt: 'quelle heure est-il ?', usesTools: true });
    expect(d.model).toBe('small-model');
    expect(d.tier).toBe('small');
  });

  it('utilise le gros modèle sur indices de complexité', () => {
    expect(router.route({ prompt: 'analyse cette architecture' }).model).toBe('large-model');
    expect(router.route({ prompt: 'peux-tu refactor ce module' }).model).toBe('large-model');
    expect(router.route({ prompt: 'explain how this works' }).model).toBe('large-model');
  });

  it('utilise le gros modèle pour les requêtes longues', () => {
    const d = router.route({ prompt: 'x'.repeat(300), usesTools: false });
    expect(d.model).toBe('large-model');
    expect(d.reason).toMatch(/longue/i);
  });

  it('utilise le gros modèle si la requête contient un bloc de code', () => {
    const d = router.route({ prompt: 'regarde ```const a = 1```' });
    expect(d.model).toBe('large-model');
  });

  it("ne rétrograde PAS une requête d'action courte (capture écran, ouvre, envoie…)", () => {
    // Régression : « Capture mon écran et décris ce que tu vois » partait sur le
    // 3B (court + sans mot-clé complexe) qui sortait un français cassé.
    expect(router.route({ prompt: 'Capture mon écran et décris ce que tu vois' }).model).toBe(
      'large-model',
    );
    expect(router.route({ prompt: 'ouvre le fichier rapport.pdf' }).model).toBe('large-model');
    expect(router.route({ prompt: 'envoie un message sur Discord' }).model).toBe('large-model');
    expect(router.route({ prompt: 'que vois-tu à l’écran ?' }).model).toBe('large-model');
  });

  it('garde le petit modèle pour une vraie trivialité conversationnelle', () => {
    expect(router.route({ prompt: 'bonjour' }).model).toBe('small-model');
    expect(router.route({ prompt: 'quelle heure est-il ?' }).model).toBe('small-model');
    expect(router.route({ prompt: 'merci beaucoup' }).model).toBe('small-model');
  });

  it('ne rétrograde PAS une question actu/articles (mission première du bot)', () => {
    // Régression : « quelles sont les news qui concernent claude ? » partait sur
    // le 7B (court, aucun indice) qui annonçait search_dailies en texte au lieu
    // de l'appeler, puis déballait toute la daily → ~2 min de réponse.
    expect(router.route({ prompt: 'quelles sont les news qui concernent claude ?' }).model).toBe(
      'large-model',
    );
    expect(router.route({ prompt: "c'est quoi l'actu du jour ?" }).model).toBe('large-model');
    expect(router.route({ prompt: 'un article parle de Nvidia ?' }).model).toBe('large-model');
    expect(router.route({ prompt: 'quoi de neuf ?' }).model).toBe('large-model');
    expect(router.route({ prompt: 'résume la daily du Monde' }).model).toBe('large-model');
  });

  it('respecte forceModel', () => {
    const d = router.route({ prompt: 'bonjour', forceModel: 'pinned-model' });
    expect(d.model).toBe('pinned-model');
    expect(d.tier).toBe('forced');
  });

  it('respecte un seuil de longueur personnalisé', () => {
    const tight = new ModelRouter({ small: 's', large: 'l', lengthThreshold: 5 });
    expect(tight.route({ prompt: 'court' }).model).toBe('s'); // 5 chars, pas > 5
    expect(tight.route({ prompt: 'un peu plus long' }).model).toBe('l');
  });
});

describe('resolveModel (modes auto/light/code)', () => {
  const base = { requested: 'default', light: 'light-m', code: 'code-m', usesTools: false };

  it('mode light force le modèle léger', () => {
    expect(resolveModel({ ...base, mode: 'light', input: 'analyse complexe' }).model).toBe(
      'light-m',
    );
  });

  it('mode code force le modèle heavy', () => {
    expect(resolveModel({ ...base, mode: 'code', input: 'salut' }).model).toBe('code-m');
  });

  it('mode auto : trivial → léger', () => {
    expect(resolveModel({ ...base, mode: 'auto', input: 'bonjour' }).model).toBe('light-m');
  });

  it('mode auto : complexe → modèle principal demandé (pas le code lourd)', () => {
    // En auto, la borne haute est `requested`; le modèle de code ne sert qu'en
    // mode 'code' explicite (le 14B est trop lent en auto sur cette machine).
    expect(resolveModel({ ...base, mode: 'auto', input: 'refactor ce module' }).model).toBe(
      'default',
    );
  });

  it("mode auto : la présence d'outils seule n'escalade pas (trivial → léger)", () => {
    expect(resolveModel({ ...base, mode: 'auto', input: 'salut', usesTools: true }).model).toBe(
      'light-m',
    );
  });

  it('repli sur requested quand un modèle manque', () => {
    expect(
      resolveModel({ mode: 'light', requested: 'default', input: 'x', usesTools: false }).model,
    ).toBe('default');
    expect(
      resolveModel({ mode: 'code', requested: 'default', input: 'x', usesTools: false }).model,
    ).toBe('default');
  });

  it('auto sans modèle léger distinct → requested', () => {
    expect(
      resolveModel({ mode: 'auto', requested: 'default', input: 'bonjour', usesTools: false })
        .model,
    ).toBe('default');
  });
});
