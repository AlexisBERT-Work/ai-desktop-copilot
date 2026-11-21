import { createServer, type IncomingMessage, type Server } from 'http';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { linkFilePath, NEXUS_UNREACHABLE, nexusRequest, readLink } from './link';

const TOKEN = 'jeton-de-liaison-catdesk-0123456789';

interface Seen {
  method: string;
  url: string;
  auth: string | undefined;
  body: string;
}

/** Un faux backend Nexus : répond `reply(req)` et note ce qu'il a reçu. */
async function fakeNexus(
  reply: (seen: Seen) => { status: number; body: unknown },
): Promise<{ server: Server; port: number; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const s = {
        method: req.method ?? '',
        url: req.url ?? '',
        auth: req.headers.authorization,
        body,
      };
      seen.push(s);
      const out = reply(s);
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port, seen };
}

let dir: string;
let linkPath: string;
let server: Server | undefined;

function writeLink(port: number, extra: Record<string, unknown> = {}) {
  const link = {
    version: 1,
    port,
    token: TOKEN,
    pid: process.pid,
    workspace: 'C:\\M',
    nexus: '0.1.0',
  };
  writeFileSync(linkPath, JSON.stringify({ ...link, ...extra }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexus-link-'));
  linkPath = join(dir, 'link.json');
});

afterEach(async () => {
  if (server) await new Promise(resolve => server?.close(resolve));
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('fichier de liaison', () => {
  it('se trouve dans %LOCALAPPDATA%\\Nexus, ou là où CATDESK_NEXUS_LINK le dit', () => {
    expect(linkFilePath({ LOCALAPPDATA: 'C:\\L' })).toBe(join('C:\\L', 'Nexus', 'link.json'));
    expect(linkFilePath({ LOCALAPPDATA: 'C:\\L', CATDESK_NEXUS_LINK: 'D:\\x.json' })).toBe(
      'D:\\x.json',
    );
    expect(linkFilePath({ CATDESK_NEXUS_LINK: '' })).toMatch(/Nexus[\\/]link\.json$/);
  });

  it('absent : Nexus fermé ou liaison coupée', () => {
    expect(readLink(linkPath)).toEqual({ ok: false, error: NEXUS_UNREACHABLE });
  });

  it('laissé par un Nexus mort : rien à en tirer', () => {
    writeLink(1234, { pid: 2 ** 31 - 2 });
    expect(readLink(linkPath)).toEqual({ ok: false, error: NEXUS_UNREACHABLE });
  });

  it("d'une version inconnue : refusé avec un message clair", () => {
    writeLink(1234, { version: 2 });
    const res = readLink(linkPath);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/illisible/);
  });
});

describe('nexusRequest', () => {
  it('appelle /link/v1 avec le jeton de liaison, paramètres encodés', async () => {
    const fake = await fakeNexus(() => ({ status: 200, body: { results: [{ path: 'a.md' }] } }));
    server = fake.server;
    writeLink(fake.port);
    const res = await nexusRequest<{ results: unknown[] }>('search', {
      query: { q: 'régression linéaire', course: undefined, limit: 3 },
      linkPath,
    });
    expect(res).toEqual({ ok: true, data: { results: [{ path: 'a.md' }] } });
    expect(fake.seen[0]?.auth).toBe(`Bearer ${TOKEN}`);
    const url = new URL(fake.seen[0]?.url ?? '', 'http://x');
    expect(url.pathname).toBe('/link/v1/search');
    expect(url.searchParams.get('q')).toBe('régression linéaire');
    expect(url.searchParams.has('course')).toBe(false);
  });

  it('envoie le corps en JSON pour un POST', async () => {
    const fake = await fakeNexus(() => ({ status: 200, body: { path: 'notes/inbox.md' } }));
    server = fake.server;
    writeLink(fake.port);
    await nexusRequest('inbox', { method: 'POST', body: { text: 'x' }, linkPath });
    expect(fake.seen[0]?.method).toBe('POST');
    expect(JSON.parse(fake.seen[0]?.body ?? '')).toEqual({ text: 'x' });
  });

  it('401 (liaison coupée entre-temps) : même message que Nexus fermé', async () => {
    const fake = await fakeNexus(() => ({ status: 401, body: { detail: 'unauthorized' } }));
    server = fake.server;
    writeLink(fake.port);
    expect(await nexusRequest('info', { linkPath })).toEqual({
      ok: false,
      error: NEXUS_UNREACHABLE,
    });
  });

  it("relaie le message d'erreur de Nexus", async () => {
    const fake = await fakeNexus(() => ({
      status: 403,
      body: { detail: 'Notes rapides refusées dans Nexus' },
    }));
    server = fake.server;
    writeLink(fake.port);
    expect(await nexusRequest('inbox', { method: 'POST', body: { text: 'x' }, linkPath })).toEqual({
      ok: false,
      error: 'Nexus : Notes rapides refusées dans Nexus (HTTP 403)',
    });
  });

  it('port fermé : Nexus injoignable, sans exception', async () => {
    const fake = await fakeNexus(() => ({ status: 200, body: {} }));
    const port = fake.port;
    await new Promise(resolve => fake.server.close(resolve));
    writeLink(port);
    expect(await nexusRequest('info', { linkPath, timeoutMs: 2_000 })).toEqual({
      ok: false,
      error: NEXUS_UNREACHABLE,
    });
  });
});
