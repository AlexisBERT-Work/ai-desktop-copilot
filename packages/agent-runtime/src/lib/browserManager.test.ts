import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BrowserManager, findSystemBrowser, isWriteMethod } from './browserManager';

describe('isWriteMethod', () => {
  it('GET, HEAD et OPTIONS lisent ; tout le reste écrit', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS', 'get']) expect(isWriteMethod(m)).toBe(false);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) expect(isWriteMethod(m)).toBe(true);
  });
});

describe('findSystemBrowser', () => {
  const saved = process.env['CATDESK_BROWSER_PATH'];
  afterEach(() => {
    if (saved === undefined) delete process.env['CATDESK_BROWSER_PATH'];
    else process.env['CATDESK_BROWSER_PATH'] = saved;
  });

  it('CATDESK_BROWSER_PATH l’emporte quand le fichier existe', () => {
    process.env['CATDESK_BROWSER_PATH'] = process.execPath;
    expect(findSystemBrowser()).toBe(process.execPath);
  });

  it('vide ou introuvable : ignoré', () => {
    process.env['CATDESK_BROWSER_PATH'] = '   ';
    expect(findSystemBrowser()).not.toBe('   ');
    process.env['CATDESK_BROWSER_PATH'] = 'Z:/nulle-part/chrome.exe';
    expect(findSystemBrowser()).not.toBe('Z:/nulle-part/chrome.exe');
  });
});

// ─── Intégration : un vrai navigateur sur un serveur local ─────────────────
// Sauté s'il n'y a pas de navigateur (Chrome/Edge/Chromium) sur la machine, ou
// s'il ne démarre pas (bac à sable de Chrome refusé par AppArmor sur un runner
// Linux) : c'est l'environnement qui manque, pas la lecture seule qui casse.

const PAGE = `<!doctype html><html><head><title>Formulaire</title></head><body>
<form method="post" action="/submit"><input name="q" value="x"><button id="submit">Envoyer</button></form>
<button id="fetch" onclick="fetch('/api', { method: 'POST', body: 'a=1' }).catch(() => {})">fetch</button>
<button id="beacon" onclick="navigator.sendBeacon('/beacon', 'b=2')">beacon</button>
<button id="ws" onclick="new WebSocket('ws://' + location.host + '/ws')">ws</button>
</body></html>`;

/** Pages du relevé « à toi de jouer », servies en GET. */
const HANDOFF_PAGES: Record<string, string> = {
  '/otp': `<!doctype html><title>Vérification</title><form>
<label for="c">Code reçu par SMS</label><input id="c" name="code" autocomplete="one-time-code">
<button id="ok">Valider</button></form>`,
  // Le champ de carte vit dans une iframe, comme chez un prestataire de paiement.
  '/carte': `<!doctype html><title>Paiement</title><input name="email">
<iframe src="/cadre-carte" width="300" height="60"></iframe>`,
  '/cadre-carte': `<!doctype html><input name="n" autocomplete="cc-number" placeholder="1234 1234 1234 1234">`,
  // Même iframe, mais masquée : un cadre invisible n'est pas relevé.
  '/carte-masquee': `<!doctype html><title>Accueil</title><input name="q">
<iframe src="/cadre-carte" style="display:none"></iframe>`,
  '/ordinaire': `<!doctype html><title>Connexion</title><form>
<input type="email" name="email"><input type="password" name="password">
<input name="hidden-otp" type="hidden" value="x"><button>Se connecter</button></form>`,
};

describe.skipIf(findSystemBrowser() === undefined)('BrowserManager — lecture seule', () => {
  const received: string[] = [];
  let server: Server;
  let base = '';
  let launchError = '';
  const browser = BrowserManager.get();

  beforeAll(async () => {
    server = createServer((req, res) => {
      received.push(`${req.method ?? '?'} ${req.url ?? ''}`);
      const handoffPage = HANDOFF_PAGES[req.url ?? ''];
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
      } else if (req.method === 'GET' && handoffPage !== undefined) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(handoffPage);
      } else {
        res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      await browser.navigate('about:blank');
    } catch (err) {
      launchError = String(err).slice(0, 200);
    }
  }, 60_000);

  beforeEach(ctx => {
    if (launchError !== '') ctx.skip(`navigateur non démarré : ${launchError}`);
  });

  // Fermer Chromium peut dépasser 10 s sur une machine chargée (suite complète
  // en parallèle) ; les connexions keep-alive restantes retiendraient `close`.
  afterAll(async () => {
    await browser.setReadOnly(true);
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }, 30_000);

  const writesReceived = (): string[] => received.filter(r => !r.startsWith('GET '));

  it('actif par défaut : la page se lit (GET)', async () => {
    expect(browser.isReadOnly()).toBe(true);
    const res = await browser.navigate(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.title).toBe('Formulaire');
    expect(res.readOnly).toBe(true);
    expect(received).toContain('GET /');
  }, 30_000);

  it('formulaire en POST : refusé, rien ne part', async () => {
    await browser.navigate(`${base}/`);
    const blocked = await browser.click('#submit');
    expect(blocked).toContainEqual({
      method: 'POST',
      url: `${base}/submit`,
      resourceType: 'document',
    });
    expect(writesReceived()).toEqual([]);
  }, 30_000);

  it('fetch POST, sendBeacon et WebSocket : refusés', async () => {
    await browser.navigate(`${base}/`);
    const fetchBlocked = await browser.click('#fetch');
    const beaconBlocked = await browser.click('#beacon');
    const wsBlocked = await browser.click('#ws');
    expect(fetchBlocked.map(b => b.method)).toEqual(['POST']);
    expect(beaconBlocked.map(b => b.method)).toEqual(['POST']);
    expect(wsBlocked).toEqual([
      { method: 'WEBSOCKET', url: expect.stringContaining('/ws'), resourceType: 'websocket' },
    ]);
    expect(writesReceived()).toEqual([]);
  }, 30_000);

  it('à toi de jouer : code à usage unique repéré dans la vraie page', async () => {
    await browser.navigate(`${base}/otp`);
    expect(await browser.detectHandoff()).toMatchObject({ kind: 'one_time_code' });
  }, 30_000);

  it('à toi de jouer : champ de carte dans une iframe visible, pas dans une masquée', async () => {
    await browser.navigate(`${base}/carte`, { waitUntil: 'load' });
    expect(await browser.detectHandoff()).toMatchObject({ kind: 'payment' });
    await browser.navigate(`${base}/carte-masquee`, { waitUntil: 'load' });
    expect(await browser.detectHandoff()).toBeNull();
  }, 30_000);

  it('à toi de jouer : une connexion ordinaire n’est pas rendue', async () => {
    await browser.navigate(`${base}/ordinaire`);
    expect(await browser.detectHandoff()).toBeNull();
  }, 30_000);

  it('lecture seule coupée : le formulaire part', async () => {
    await browser.setReadOnly(false);
    await browser.navigate(`${base}/`);
    const blocked = await browser.click('#submit');
    expect(blocked).toEqual([]);
    await expect.poll(() => writesReceived()).toContain('POST /submit');
    await browser.setReadOnly(true);
  }, 30_000);
});
