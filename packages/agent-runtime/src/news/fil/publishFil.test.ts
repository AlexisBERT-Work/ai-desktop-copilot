import { describe, expect, it, vi } from 'vitest';
import { makeCard } from './filCards';
import { FIL_PER_CALL, publishFil, readFilPublishConfig } from './publishFil';

const CFG = {
  url: 'https://abc.supabase.co',
  anonKey: 'anon',
  token: 's3cret-token-0123456789abcdef0123',
};

const cards = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    makeCard({ kind: 'breve', day: '2026-11-08', rank: i, title: `Carte ${i}`, summary: 'R.' }),
  );

describe('readFilPublishConfig', () => {
  it('exige les trois valeurs, et nomme celles qui manquent', () => {
    const parsed = readFilPublishConfig({ FIL_SUPABASE_URL: 'https://abc.supabase.co' });
    expect(parsed).toEqual({
      ok: false,
      error: 'Fil : FIL_SUPABASE_ANON_KEY, FIL_PUBLISH_TOKEN manquant',
    });
  });

  it('refuse une URL qui n’est pas en https', () => {
    const parsed = readFilPublishConfig({
      FIL_SUPABASE_URL: 'http://abc.supabase.co',
      FIL_SUPABASE_ANON_KEY: 'a',
      FIL_PUBLISH_TOKEN: 't',
    });
    expect(parsed.ok).toBe(false);
  });
});

describe('publishFil', () => {
  it('appelle la RPC avec la clé anon et le jeton, et additionne les insertions', async () => {
    const post = vi.fn().mockResolvedValue({ status: 200, text: '3' });
    const res = await publishFil(CFG, cards(FIL_PER_CALL + 5), post);
    expect(res).toEqual({ ok: true, inserted: 6 });
    expect(post).toHaveBeenCalledTimes(2);
    const [url, payload, opts] = post.mock.calls[0]!;
    expect(url).toBe('https://abc.supabase.co/rest/v1/rpc/fil_publish');
    expect(payload.p_token).toBe(CFG.token);
    expect(payload.p_cards).toHaveLength(FIL_PER_CALL);
    expect(opts.headers).toMatchObject({ apikey: 'anon', Authorization: 'Bearer anon' });
  });

  it('une erreur de la base remonte, sans jamais citer le jeton', async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ status: 401, text: '{"message":"jeton de publication refusé"}' });
    const res = await publishFil(CFG, cards(1), post);
    expect(res).toEqual({ ok: false, error: 'Fil : HTTP 401, jeton de publication refusé' });
    expect(JSON.stringify(res)).not.toContain(CFG.token);
  });

  it('réseau en panne : échec propre', async () => {
    const post = vi.fn().mockRejectedValue(new Error('timeout'));
    expect(await publishFil(CFG, cards(1), post)).toEqual({
      ok: false,
      error: 'Fil injoignable : timeout',
    });
  });

  it('rien à publier : aucun appel', async () => {
    const post = vi.fn();
    expect(await publishFil(CFG, [], post)).toEqual({ ok: true, inserted: 0 });
    expect(post).not.toHaveBeenCalled();
  });
});
