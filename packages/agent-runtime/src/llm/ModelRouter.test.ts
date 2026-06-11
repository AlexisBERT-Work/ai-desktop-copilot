import { describe, it, expect } from 'vitest';
import { ModelRouter } from './ModelRouter';

const router = new ModelRouter({ small: 'small-model', large: 'large-model' });

describe('ModelRouter', () => {
  it('rétrograde vers le petit modèle pour une tâche simple et courte', () => {
    const d = router.route({ prompt: 'bonjour', usesTools: false });
    expect(d.model).toBe('small-model');
    expect(d.tier).toBe('small');
  });

  it('utilise le gros modèle quand des outils sont impliqués', () => {
    const d = router.route({ prompt: 'quelle heure est-il ?', usesTools: true });
    expect(d.model).toBe('large-model');
    expect(d.tier).toBe('large');
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
