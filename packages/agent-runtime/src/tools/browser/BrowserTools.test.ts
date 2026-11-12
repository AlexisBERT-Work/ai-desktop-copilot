import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockedWrite } from '../../lib/browserManager';

// Aucun vrai navigateur : on observe ce que les outils font de la réponse du gestionnaire.
const manager = {
  navigate: vi.fn(),
  click: vi.fn(),
  fill: vi.fn(),
  isOpen: vi.fn(() => true),
  getCurrentUrl: vi.fn(() => 'https://exemple.fr/'),
};
vi.mock('../../lib/browserManager', () => ({ BrowserManager: { get: () => manager } }));

import { BrowserNavigateTool } from './BrowserNavigateTool';
import { BrowserClickTool } from './BrowserClickTool';
import { BrowserTypeTool } from './BrowserTypeTool';
import { blockedWritesReport } from './blockedWrites';
import { expectOk } from '../base/testResult';

const form: BlockedWrite = {
  method: 'POST',
  url: 'https://exemple.fr/login',
  resourceType: 'document',
};
const beacon: BlockedWrite = {
  method: 'POST',
  url: 'https://stats.exemple.fr/collect',
  resourceType: 'ping',
};

beforeEach(() => {
  vi.clearAllMocks();
  manager.isOpen.mockReturnValue(true);
});

describe('browser_navigate', () => {
  it('page lue sans écriture refusée : résultat inchangé', async () => {
    manager.navigate.mockResolvedValue({
      title: 'Accueil',
      url: 'https://exemple.fr/',
      status: 200,
      readOnly: true,
      blockedWrites: [],
    });
    const { data } = expectOk(await new BrowserNavigateTool().run({ url: 'https://exemple.fr' }));
    expect(data).toEqual({
      title: 'Accueil',
      url: 'https://exemple.fr/',
      status: 200,
      readOnly: true,
    });
  });

  it('statistiques refusées pendant le chargement : signalées, sans alarmer', async () => {
    manager.navigate.mockResolvedValue({
      title: 'Accueil',
      url: 'https://exemple.fr/',
      status: 200,
      readOnly: true,
      blockedWrites: [beacon],
    });
    const { data } = expectOk(await new BrowserNavigateTool().run({ url: 'https://exemple.fr' }));
    expect(data).toMatchObject({
      blockedWrites: ['POST https://stats.exemple.fr/collect'],
      readOnlyNotice: expect.stringContaining("La lecture n'est pas gênée"),
    });
  });
});

describe('browser_click', () => {
  it('formulaire refusé : non envoyé, et consigne de ne pas réessayer', async () => {
    manager.click.mockResolvedValue([form]);
    const { data } = expectOk(await new BrowserClickTool().run({ selector: '#login' }));
    expect(data).toMatchObject({
      clicked: '#login',
      formSubmitted: false,
      readOnlyNotice:
        "Formulaire non envoyé : navigateur en lecture seule. Ne réessaie pas, dis-le à l'utilisateur.",
    });
  });

  it('autre écriture refusée : message générique', async () => {
    manager.click.mockResolvedValue([beacon]);
    const { data } = expectOk(await new BrowserClickTool().run({ selector: '#like' }));
    expect(data).not.toHaveProperty('formSubmitted');
    expect(data).toMatchObject({ readOnlyNotice: expect.stringContaining('1 requête refusée') });
  });

  it('rien de refusé : pas de mention de la lecture seule', async () => {
    manager.click.mockResolvedValue([]);
    const { data } = expectOk(await new BrowserClickTool().run({ selector: '#menu' }));
    expect(data).toEqual({ clicked: '#menu', url: 'https://exemple.fr/' });
  });
});

describe('browser_type', () => {
  it('enregistrement automatique refusé pendant la saisie : signalé', async () => {
    manager.fill.mockResolvedValue([beacon, beacon]);
    const { data } = expectOk(await new BrowserTypeTool().run({ selector: '#q', text: 'bonjour' }));
    expect(data).toMatchObject({
      charsTyped: 7,
      readOnlyNotice: expect.stringContaining('2 requêtes refusées'),
    });
  });
});

describe('blockedWritesReport', () => {
  it('cite 5 écritures au plus, puis le total ; URL coupées à 200 caractères', () => {
    const long: BlockedWrite = { ...beacon, url: `https://exemple.fr/${'a'.repeat(300)}` };
    const report = blockedWritesReport(
      [long, ...Array.from({ length: 6 }, () => beacon)],
      'interact',
    );
    expect(report['blockedWrites']).toHaveLength(5);
    expect(report['blockedWritesTotal']).toBe(7);
    expect((report['blockedWrites'] as string[])[0]).toHaveLength('POST '.length + 200);
  });

  it('rien de refusé : rapport vide', () => {
    expect(blockedWritesReport([], 'navigate')).toEqual({});
  });
});
