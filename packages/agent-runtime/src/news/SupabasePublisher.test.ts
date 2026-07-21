import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasTodaysSharedDigest,
  publishDailiesOpen,
  type SupabaseOpenConfig,
} from './SupabasePublisher';
import type { JournalDraft } from './pressDigest';

const cfg: SupabaseOpenConfig = { url: 'https://proj.supabase.co', anonKey: 'anon-key' };

function draft(over: Partial<JournalDraft> = {}): JournalDraft {
  return {
    journal: 'Le Monde',
    category: 'misc',
    title: 'Le Monde — revue du 20 juillet',
    body: 'Corps de la daily.',
    ...over,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('publishDailiesOpen', () => {
  it('signe anonymement puis appelle la RPC pour chaque draft (title/body/category)', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('/auth/v1/signup')) return jsonResponse({ access_token: 'jwt-anon' });
      return jsonResponse(true); // RPC : insertion réussie
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await publishDailiesOpen(cfg, [draft()]);

    expect(res.published).toBe(1);
    expect(res.skipped).toBe(0);
    expect(res.errors).toEqual([]);
    expect(res.publishedDrafts).toHaveLength(1);

    const rpcCall = calls.find(c => c.url.includes('/rpc/publish_daily_if_missing'));
    expect(rpcCall?.body).toEqual({
      p_title: 'Le Monde — revue du 20 juillet',
      p_body: 'Corps de la daily.',
      p_category: 'misc',
    });
  });

  it('la RPC renvoie false (déjà publié par un autre poste) → skipped, pas une erreur', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/auth/v1/signup')) return jsonResponse({ access_token: 'jwt-anon' });
        return jsonResponse(false);
      }),
    );

    const res = await publishDailiesOpen(cfg, [draft()]);
    expect(res.published).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.errors).toEqual([]);
  });

  it('plusieurs drafts : compte published/skipped indépendamment', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/auth/v1/signup')) return jsonResponse({ access_token: 'jwt-anon' });
        n += 1;
        return jsonResponse(n === 1); // le premier passe, le second est déjà là
      }),
    );

    const res = await publishDailiesOpen(cfg, [draft({ title: 'A' }), draft({ title: 'B' })]);
    expect(res.published).toBe(1);
    expect(res.skipped).toBe(1);
  });

  it('échec de la connexion anonyme : erreur reportée, aucune RPC tentée', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error_description: 'nope' }, false, 500));
    vi.stubGlobal('fetch', fetchMock);

    const res = await publishDailiesOpen(cfg, [draft()]);
    expect(res.errors).toHaveLength(1);
    expect(res.published).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // seulement le signup, pas de RPC
  });

  it('échec HTTP sur un appel RPC : erreur pour CE draft, ne bloque pas les suivants', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/auth/v1/signup')) return jsonResponse({ access_token: 'jwt-anon' });
        call += 1;
        return call === 1 ? jsonResponse({}, false, 500) : jsonResponse(true);
      }),
    );

    const res = await publishDailiesOpen(cfg, [draft({ title: 'A' }), draft({ title: 'B' })]);
    expect(res.errors).toHaveLength(1);
    expect(res.published).toBe(1);
  });

  it('liste vide : ne fait aucun appel réseau', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await publishDailiesOpen(cfg, []);
    expect(res).toEqual({ published: 0, skipped: 0, errors: [], publishedDrafts: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('hasTodaysSharedDigest', () => {
  it('vrai si la lecture renvoie au moins une ligne', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/auth/v1/signup')) return jsonResponse({ access_token: 'jwt-anon' });
        return jsonResponse([{ id: 'x' }]);
      }),
    );
    expect(await hasTodaysSharedDigest(cfg)).toBe(true);
  });

  it('faux si la lecture renvoie une liste vide', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/auth/v1/signup')) return jsonResponse({ access_token: 'jwt-anon' });
        return jsonResponse([]);
      }),
    );
    expect(await hasTodaysSharedDigest(cfg)).toBe(false);
  });

  it('faux (jamais throw) si le réseau échoue — on préfère régénérer que bloquer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    await expect(hasTodaysSharedDigest(cfg)).resolves.toBe(false);
  });
});
