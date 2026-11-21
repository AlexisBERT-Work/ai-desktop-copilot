import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockedWrite } from '../../lib/browserManager';
import type { Handoff } from '../../lib/browserHandoff';

// Aucun vrai navigateur : on observe ce que les outils font de la réponse du gestionnaire.
const manager = {
  navigate: vi.fn(),
  click: vi.fn(),
  fill: vi.fn(),
  detectHandoff: vi.fn<() => Promise<Handoff | null>>(async () => null),
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
  manager.getCurrentUrl.mockReturnValue('https://exemple.fr/');
  manager.detectHandoff.mockResolvedValue(null);
});

describe('targetUrl — le site visé par l’accord « pour ce site »', () => {
  it('browser_navigate : l’URL demandée', () => {
    const tool = new BrowserNavigateTool();
    expect(tool.targetUrl({ url: 'https://www.exemple.fr/a' })).toBe('https://www.exemple.fr/a');
    expect(tool.targetUrl({ url: 42 })).toBeUndefined();
  });

  it('browser_click et browser_type : la page courante, rien sans page ouverte', () => {
    manager.getCurrentUrl.mockReturnValue('https://boutique.fr/panier');
    expect(new BrowserClickTool().targetUrl()).toBe('https://boutique.fr/panier');
    expect(new BrowserTypeTool().targetUrl()).toBe('https://boutique.fr/panier');
    manager.isOpen.mockReturnValue(false);
    expect(new BrowserClickTool().targetUrl()).toBeUndefined();
  });
});

describe('à toi de jouer — CAPTCHA, code à usage unique, paiement', () => {
  it('clic sur une page de paiement : rien n’est cliqué, la main revient à l’utilisateur', async () => {
    manager.detectHandoff.mockResolvedValue({
      kind: 'payment',
      evidence: 'autocomplete=cc-number',
    });
    manager.getCurrentUrl.mockReturnValue('https://boutique.fr/paiement');
    const { data } = expectOk(await new BrowserClickTool().run({ selector: '#payer' }));
    expect(manager.click).not.toHaveBeenCalled();
    expect(data).toMatchObject({
      handedOff: true,
      reason: 'payment',
      url: 'https://boutique.fr/paiement',
      userAction: expect.stringContaining('À toi de jouer'),
    });
  });

  it('saisie face à un code 2FA : rien n’est tapé', async () => {
    manager.detectHandoff.mockResolvedValue({ kind: 'one_time_code', evidence: 'x' });
    const { data } = expectOk(
      await new BrowserTypeTool().run({ selector: '#code', text: '123456' }),
    );
    expect(manager.fill).not.toHaveBeenCalled();
    expect(data).toMatchObject({ handedOff: true, reason: 'one_time_code' });
  });

  it('CAPTCHA : idem pour le clic', async () => {
    manager.detectHandoff.mockResolvedValue({ kind: 'captcha', evidence: 'iframe' });
    const { data } = expectOk(await new BrowserClickTool().run({ selector: '#envoyer' }));
    expect(manager.click).not.toHaveBeenCalled();
    expect(data).toMatchObject({ handedOff: true, reason: 'captcha' });
  });
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
