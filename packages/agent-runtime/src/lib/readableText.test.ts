import { describe, expect, it } from 'vitest';
import { looksGarbled } from './readableText';

// Réponses réellement trouvées dans la mémoire d'un poste (incident KV-cache de
// juin 2026), tronquées.
const GARBLED = [
  "Je suis dés che que v' st( is e faie c6 ilf e8e n a6 a7 e eef r10 01036666 the l 6 dffe ` e4 e50570 93 0c f2 6 f e [0916ee0 1ch160 0 9 e0 e10 10 8 la 1 ch e e 0 00f 10",
  'l d \\1\\0 14 2 31 23 1  9t 3 8e 2 6 1 7 1 21s 9 8 p 5 4 583 2 4 2 6 1 9  e 7 1 3e 8 5 9 1 8  r 3 0  fin 7  3 5 8 8 1 2 43 1 1  38)t0 0 1 8',
  '.\n.\n##4ef\n0r puntq ergroundColor r. 0l0fft0 f81ft 9[n0}0 700541 0 2s0   f  9090h1c 3 d0  0 5000094  cb09`.\n  21 94   081200  n0  11000000 1n',
  '001 yn rech (t ) 2(  ( () 01 )\n)))\n), ,0 0,0,0,0,0,0,\n\n0,00,1\ny)\n\n00f30, 0,)0 ( 0 ( (0,0 0,0,0,0,0,0,0,0( 0, )0,000,0 14 de lacond 2 d 15 1 2 6',
];

const READABLE = [
  "Il existe plusieurs types de structures juridiques pour une entreprise en France, chacune ayant des caractéristiques spécifiques. Voici quelques-unes des principales :\n\n1. **Société par Actions Simplifiée (SAS)**\n   - C'est la forme la plus répandue.",
  'Apple cote 338,14 $ (−0,67 %), Microsoft 536,05 $ (+2,57 %) et Tesla 384,05 $ (+2,41 %) ce midi, selon la watchlist.',
  "Selon Le Monde du 8 octobre 2026, le PIB a progressé de 0,3 % au 3e trimestre ; l'Insee table sur 1,1 % sur l'année (source : https://www.lemonde.fr/economie/article).",
  '- **Le Figaro** : la réforme des retraites revient au Parlement.\n- **Les Échos** : le CAC 40 termine à 7 412 points (+0,8 %).',
  'The provided image is a depiction of a modern house with a contemporary architectural style and large windows.',
  'Paris.',
];

describe('looksGarbled', () => {
  it.each(GARBLED)('repère une réponse corrompue (%#)', text => {
    expect(looksGarbled(text)).toBe(true);
  });

  it.each(READABLE)('laisse passer un texte lisible — chiffres, Markdown, liens (%#)', text => {
    expect(looksGarbled(text)).toBe(false);
  });
});
