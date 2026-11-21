import { describe, expect, it } from 'vitest';
import { registrableDomain } from './registrableDomain';

describe('registrableDomain', () => {
  it.each([
    ['https://exemple.fr', 'exemple.fr'],
    ['https://www.exemple.fr/a?b=1', 'exemple.fr'],
    ['https://m.exemple.fr', 'exemple.fr'],
    ['http://EXEMPLE.FR./', 'exemple.fr'],
    // Suffixes publics à deux niveaux (partie ICANN de la liste).
    ['https://news.bbc.co.uk', 'bbc.co.uk'],
    // Partie privée : chaque locataire d'un suffixe partagé est un site.
    ['https://alice.github.io/projet', 'alice.github.io'],
    ['https://foo.blogspot.com', 'foo.blogspot.com'],
    // Un suffixe ouvert tel quel ne s'étend pas à ses locataires.
    ['https://github.io/', 'github.io'],
    // Noms internationalisés : forme punycode, comme l'URL les normalise.
    ['https://bücher.de', 'xn--bcher-kva.de'],
  ])('%s → %s', (url, site) => {
    expect(registrableDomain(url)).toBe(site);
  });

  it('IP, localhost et noms d’intranet sont leur propre site', () => {
    expect(registrableDomain('http://127.0.0.1:8080/')).toBe('127.0.0.1');
    expect(registrableDomain('http://[::1]:3000/')).toBe('[::1]');
    expect(registrableDomain('http://localhost:5173')).toBe('localhost');
    expect(registrableDomain('http://intranet/')).toBe('intranet');
  });

  it('hors http(s) ou illisible : aucun site', () => {
    for (const url of ['about:blank', 'file:///C:/x.html', 'data:text/html,x', 'pas une url', '']) {
      expect(registrableDomain(url)).toBeUndefined();
    }
  });
});
