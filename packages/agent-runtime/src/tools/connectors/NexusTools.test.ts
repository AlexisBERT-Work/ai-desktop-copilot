import { createServer, type Server } from 'http';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NEXUS_UNREACHABLE } from '../../nexus/link';
import { expectFail, expectOk } from '../base/testResult';
import { NexusCoursesTool, PASSAGE_CHARS, SEARCH_LIMIT, slimSearch } from './NexusCoursesTool';
import { NexusInboxTool } from './NexusInboxTool';

interface Call {
  method: string;
  path: string;
  params: URLSearchParams;
  body: unknown;
}

let dir: string;
let linkPath: string;
let server: Server | undefined;
let calls: Call[];
let reply: (call: Call) => { status: number; body: unknown };

/** Faux backend Nexus derrière un vrai fichier de liaison. */
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nexus-tools-'));
  linkPath = join(dir, 'link.json');
  calls = [];
  reply = () => ({ status: 200, body: { ok: true } });
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      const url = new URL(req.url ?? '', 'http://x');
      const call = {
        method: req.method ?? '',
        path: url.pathname,
        params: url.searchParams,
        body: raw ? (JSON.parse(raw) as unknown) : undefined,
      };
      calls.push(call);
      const out = reply(call);
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  writeFileSync(
    linkPath,
    JSON.stringify({
      version: 1,
      port,
      token: 'jeton-de-liaison-catdesk-0123456789',
      pid: process.pid,
      workspace: 'C:\\M',
      nexus: '0.1.0',
    }),
  );
});

afterEach(async () => {
  if (server) await new Promise(resolve => server?.close(resolve));
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('nexus_courses', () => {
  it('list : les cours de Nexus', async () => {
    reply = () => ({ status: 200, body: { courses: [{ slug: 'ia', title: 'IA' }] } });
    const res = expectOk(await new NexusCoursesTool(linkPath).run({ action: 'list' }));
    expect(res.data).toEqual({ courses: [{ slug: 'ia', title: 'IA' }] });
    expect(calls[0]?.path).toBe('/link/v1/info');
  });

  it('search : la question, le cours et 5 passages par défaut', async () => {
    const tool = new NexusCoursesTool(linkPath);
    expectOk(await tool.run({ action: 'search', query: ' attention ', course: 'ia' }));
    expect(calls[0]?.path).toBe('/link/v1/search');
    expect(Object.fromEntries(calls[0]?.params ?? [])).toEqual({
      q: 'attention',
      course: 'ia',
      limit: String(SEARCH_LIMIT),
    });
    const err = expectFail(await tool.run({ action: 'search' }));
    expect(err.error).toMatch(/query/);
    expect(calls).toHaveLength(1); // rien envoyé sans question
  });

  it('search : au modèle, seulement path, titre, position et texte coupé', async () => {
    const long = 'a'.repeat(PASSAGE_CHARS + 50);
    reply = () => ({
      status: 200,
      body: {
        semantic: true,
        results: [
          {
            path: 'cours/ia/notebooks/03.ipynb',
            course: 'ia',
            kind: 'notebook',
            title: 'Attention',
            anchor: { cell: 12 },
            snippet: 'la **attention**',
            text: long,
          },
          {
            path: 'cours/ia/x.png',
            course: 'ia',
            kind: 'doc',
            title: '',
            anchor: {},
            snippet: 'ocr',
            text: '',
          },
        ],
      },
    });
    const res = expectOk(
      await new NexusCoursesTool(linkPath).run({ action: 'search', query: 'attention' }),
    );
    expect(res.data).toEqual({
      results: [
        {
          path: 'cours/ia/notebooks/03.ipynb',
          title: 'Attention',
          anchor: { cell: 12 },
          text: `${'a'.repeat(PASSAGE_CHARS)}…`,
        },
        { path: 'cours/ia/x.png', text: 'ocr' }, // pas de texte : l'extrait, faute de mieux
      ],
    });
  });

  it('search : une réponse d’une autre forme passe telle quelle', () => {
    expect(slimSearch({ autre: 1 })).toEqual({ autre: 1 });
  });

  it('read : le document par son path ; refusé sans', async () => {
    const tool = new NexusCoursesTool(linkPath);
    expectOk(await tool.run({ action: 'read', document: 'cours/ia/ressources/td.pdf' }));
    expect(calls[0]?.params.get('path')).toBe('cours/ia/ressources/td.pdf');
    expect(expectFail(await tool.run({ action: 'read' })).error).toMatch(/document/);
  });

  it('today : horizon transmis seulement s’il est donné', async () => {
    const tool = new NexusCoursesTool(linkPath);
    expectOk(await tool.run({ action: 'today' }));
    expectOk(await tool.run({ action: 'today', days: 30 }));
    expect(calls[0]?.params.has('days')).toBe(false);
    expect(calls[1]?.params.get('days')).toBe('30');
  });

  it('open : un cours ou un document, en POST', async () => {
    const tool = new NexusCoursesTool(linkPath);
    expectOk(await tool.run({ action: 'open', course: 'ia' }));
    expectOk(await tool.run({ action: 'open', document: 'cours/ia/notes/n.md' }));
    expect(calls.map(c => [c.method, c.path, c.body])).toEqual([
      ['POST', '/link/v1/open', { course: 'ia' }],
      ['POST', '/link/v1/open', { path: 'cours/ia/notes/n.md' }],
    ]);
    expect(expectFail(await tool.run({ action: 'open' })).error).toMatch(/course/);
  });

  it('Nexus fermé : message qui dit où activer la liaison', async () => {
    rmSync(linkPath);
    const err = expectFail(await new NexusCoursesTool(linkPath).run({ action: 'today' }));
    expect(err.error).toBe(NEXUS_UNREACHABLE);
    expect(err.error).toMatch(/Extensions › CatDesk/);
  });

  it('refuse une action inconnue avant tout appel', async () => {
    expectFail(await new NexusCoursesTool(linkPath).run({ action: 'delete' }));
    expect(calls).toHaveLength(0);
  });
});

describe('nexus_inbox', () => {
  it('ajoute la note', async () => {
    reply = () => ({ status: 200, body: { path: 'notes/inbox.md' } });
    const res = expectOk(await new NexusInboxTool(linkPath).run({ text: 'Relire le TD 3' }));
    expect(res.data).toMatchObject({ added: true, path: 'notes/inbox.md' });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/link/v1/inbox' });
    expect(calls[0]?.body).toEqual({ text: 'Relire le TD 3' });
  });

  it('relaie le refus de Nexus', async () => {
    reply = () => ({ status: 403, body: { detail: 'Notes rapides refusées dans Nexus' } });
    const err = expectFail(await new NexusInboxTool(linkPath).run({ text: 'x' }));
    expect(err.error).toBe('Nexus : Notes rapides refusées dans Nexus (HTTP 403)');
  });

  it('refuse une note vide', async () => {
    expectFail(await new NexusInboxTool(linkPath).run({ text: '' }));
    expect(calls).toHaveLength(0);
  });
});
