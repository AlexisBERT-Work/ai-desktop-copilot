import { describe, it, expect } from 'vitest';
import { parsePlan } from './Planner';

describe('parsePlan', () => {
  it('parse une liste numérotée "1."', () => {
    expect(parsePlan('1. Chercher la doc\n2. Lire la page\n3. Résumer')).toEqual([
      'Chercher la doc',
      'Lire la page',
      'Résumer',
    ]);
  });

  it('gère les variantes "1)" et "1:"', () => {
    expect(parsePlan('1) Étape un\n2: Étape deux')).toEqual(['Étape un', 'Étape deux']);
  });

  it('gère les puces', () => {
    expect(parsePlan('- a\n* b\n• c')).toEqual(['a', 'b', 'c']);
  });

  it('ignore le préambule et ne garde que les étapes marquées', () => {
    const text = 'Voici le plan :\n1. Première étape\n2. Deuxième étape\nVoilà.';
    expect(parsePlan(text)).toEqual(['Première étape', 'Deuxième étape']);
  });

  it('retombe sur les lignes non vides si aucun marqueur', () => {
    expect(parsePlan('faire ceci\nfaire cela')).toEqual(['faire ceci', 'faire cela']);
  });

  it('renvoie un tableau vide pour une chaîne vide', () => {
    expect(parsePlan('')).toEqual([]);
    expect(parsePlan('   \n  ')).toEqual([]);
  });

  it('plafonne à 8 étapes', () => {
    const many = Array.from({ length: 12 }, (_, i) => `${i + 1}. étape ${i + 1}`).join('\n');
    expect(parsePlan(many)).toHaveLength(8);
  });
});
