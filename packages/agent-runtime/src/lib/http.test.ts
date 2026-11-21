import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchJson, httpGet, httpRequest, postJson } from './http';
import { isDiscordWebhookUrl } from './discord';

// Serveur local réel : on teste le vrai `fetch`, pas un double.
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    switch (req.url) {
      case '/ok':
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('bonjour');
        return;
      case '/relative-redirect':
        // Location relative : le client fait main de read_webpage cassait ici.
        res.writeHead(302, { Location: '/ok' }).end();
        return;
      case '/loop':
        res.writeHead(302, { Location: '/loop' }).end();
        return;
      case '/missing':
        res.writeHead(404).end('absent');
        return;
      case '/big':
        res.writeHead(200).end('x'.repeat(2_000));
        return;
      case '/slow':
        setTimeout(() => res.writeHead(200).end('tard'), 500);
        return;
      case '/json':
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"a":1}');
        return;
      case '/echo': {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () =>
          res.writeHead(201).end(
            JSON.stringify({
              body: Buffer.concat(chunks).toString(),
              ct: req.headers['content-type'],
            }),
          ),
        );
        return;
      }
      default:
        res.writeHead(500).end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

describe('httpRequest', () => {
  it('lit le corps et le statut', async () => {
    const res = await httpRequest(`${base}/ok`);
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.text).toBe('bonjour');
    expect(res.headers.get('content-type')).toBe('text/plain');
  });

  it('suit une redirection RELATIVE', async () => {
    const res = await httpRequest(`${base}/relative-redirect`);
    expect(res.text).toBe('bonjour');
  });

  it('ne boucle pas sans fin sur des redirections', async () => {
    await expect(httpRequest(`${base}/loop`)).rejects.toThrow();
  });

  it('ne lève pas sur un statut HTTP d’erreur', async () => {
    const res = await httpRequest(`${base}/missing`);
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
  });

  it('refuse un corps au-delà du plafond', async () => {
    await expect(httpRequest(`${base}/big`, { maxBytes: 1_000 })).rejects.toThrow(
      /trop volumineuse/,
    );
  });

  it('abandonne au-delà du délai', async () => {
    await expect(httpRequest(`${base}/slow`, { timeoutMs: 100 })).rejects.toThrow();
  });
});

describe('httpGet', () => {
  it('lève sur un statut ≥ 400 (contrat du pipeline presse)', async () => {
    await expect(httpGet(`${base}/missing`)).rejects.toThrow('HTTP 404');
  });
});

describe('postJson', () => {
  it('envoie un corps JSON et renvoie statut + texte', async () => {
    const res = await postJson(`${base}/echo`, { hello: 'monde' });
    expect(res.status).toBe(201);
    expect(JSON.parse(res.text)).toEqual({
      body: '{"hello":"monde"}',
      ct: 'application/json',
    });
  });
});

describe('fetchJson', () => {
  it('parse le JSON', async () => {
    expect(await fetchJson(`${base}/json`, {}, 'Test API')).toEqual({ a: 1 });
  });

  it('nomme l’API fautive quand le corps n’est pas du JSON', async () => {
    await expect(fetchJson(`${base}/ok`, {}, 'Test API')).rejects.toThrow(
      'Invalid JSON from Test API',
    );
  });
});

describe('isDiscordWebhookUrl', () => {
  it('accepte les webhooks Discord', () => {
    expect(isDiscordWebhookUrl('https://discord.com/api/webhooks/123/abc-DEF_9')).toBe(true);
    expect(isDiscordWebhookUrl('https://canary.discord.com/api/webhooks/1/x?wait=true')).toBe(true);
    expect(isDiscordWebhookUrl('https://discordapp.com/api/webhooks/1/x')).toBe(true);
  });

  it('refuse tout autre serveur ou chemin', () => {
    expect(isDiscordWebhookUrl('https://evil.example/api/webhooks/1/x')).toBe(false);
    expect(isDiscordWebhookUrl('https://discord.com.evil.example/api/webhooks/1/x')).toBe(false);
    expect(isDiscordWebhookUrl('http://discord.com/api/webhooks/1/x')).toBe(false);
    expect(isDiscordWebhookUrl('https://discord.com/channels/1/2')).toBe(false);
    expect(isDiscordWebhookUrl('pas une url')).toBe(false);
  });
});
