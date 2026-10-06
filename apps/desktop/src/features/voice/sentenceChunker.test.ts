import { describe, it, expect } from 'vitest';
import { createSentenceChunker, toSpeakable } from './sentenceChunker';

/** Rejoue un texte token par token (mots + espaces), comme le flux Ollama. */
function stream(text: string, tokenSize = 4): string[] {
  const chunker = createSentenceChunker();
  const out: string[] = [];
  for (let i = 0; i < text.length; i += tokenSize) {
    out.push(...chunker.push(text.slice(i, i + tokenSize)));
  }
  out.push(...chunker.flush());
  return out;
}

describe('createSentenceChunker', () => {
  it('sort chaque phrase dès que le blanc qui la suit est arrivé', () => {
    const chunker = createSentenceChunker();
    expect(chunker.push('Bonjour Alexis.')).toEqual([]); // « 3. » pourrait devenir « 3.14 »
    expect(chunker.push(' Il est')).toEqual(['Bonjour Alexis.']);
    expect(chunker.push(' 14 h 32, et voilà ! Suite')).toEqual(['Il est 14 h 32, et voilà !']);
    expect(chunker.flush()).toEqual(['Suite']);
  });

  it('ne coupe ni les décimales, ni les abréviations, ni les initiales', () => {
    expect(stream('Pi vaut 3.14 environ. M. Dupont et J. Martin arrivent. Fin.')).toEqual([
      'Pi vaut 3.14 environ.',
      'M. Dupont et J. Martin arrivent.',
      'Fin.',
    ]);
    expect(stream('Voir p. ex. la doc, etc. Puis on continue.')).toEqual([
      'Voir p. ex. la doc, etc. Puis on continue.',
    ]);
  });

  it('traite chaque item de liste comme une phrase, sans lire les puces', () => {
    expect(stream('Trois points :\n- premier point\n- deuxième point\n1. troisième\n')).toEqual([
      'Trois points :',
      'premier point',
      'deuxième point',
      'troisième',
    ]);
  });

  it('remplace un bloc de code par une phrase, sans en lire le contenu', () => {
    expect(stream('Voici le script.\n```bash\necho "salut"\nls -la\n```\nEt voilà.')).toEqual([
      'Voici le script.',
      'Bloc de code omis.',
      'Et voilà.',
    ]);
  });

  it('coupe une phrase-fleuve à la virgule pour ne pas retarder la voix', () => {
    const long = Array.from({ length: 40 }, (_, i) => `segment ${i}`).join(', ') + '.';
    const out = stream(long);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every(s => s.length <= 290)).toBe(true);
    expect(out.join(' ').replace(/,\s/g, ', ')).toContain('segment 39.');
  });

  it("reset jette ce qui n'a pas été dit", () => {
    const chunker = createSentenceChunker();
    chunker.push('Une phrase en cours');
    chunker.reset();
    expect(chunker.flush()).toEqual([]);
  });
});

describe('toSpeakable', () => {
  it('garde le sens, jette la typographie Markdown', () => {
    expect(toSpeakable('## Titre\n**Gras** et *italique*, `code` et [lien](https://x.y).')).toBe(
      'Titre Gras et italique, code et lien.',
    );
    expect(toSpeakable('Voir https://example.com/page maintenant')).toBe('Voir lien maintenant');
    expect(toSpeakable('> citation\n---\n<br>')).toBe('citation');
  });

  it('ne touche pas au snake_case ni aux astérisques isolés', () => {
    expect(toSpeakable('la variable max_iterations vaut 3 * 4')).toBe(
      'la variable max_iterations vaut 3 * 4',
    );
  });

  it('lit un tableau ligne par ligne, cellules séparées par des virgules', () => {
    expect(toSpeakable('| Nom | Prix |\n|---|---|\n| Pomme | 2 € |')).toBe('Nom, Prix Pomme, 2 €');
  });
});
