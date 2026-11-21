import { describe, expect, it } from 'vitest';
import { MAX_RESULT_CHARS, capResults, cleanSnippet, searchWeb, type WebHit } from './webSearch';
import { SearchWebTool } from '../tools/web/SearchWebTool';
import { expectFail, expectOk } from '../tools/base/testResult';

const NOW = new Date('2026-11-21T12:00:00Z');

/** Réponses d'API figées, choisies par l'hôte de l'URL. */
function fakeApis(overrides: Partial<Record<string, unknown>> = {}) {
  const urls: string[] = [];
  const responses: Record<string, unknown> = {
    'fr.wikipedia.org': {
      query: {
        search: [
          {
            title: 'Model Context Protocol',
            snippet:
              'Protocole <span class="searchmatch">MCP</span> publié par Anthropic &amp; ouvert',
          },
        ],
      },
    },
    'en.wikipedia.org': { query: { search: [{ title: 'English only', snippet: 'x' }] } },
    'hn.algolia.com': {
      hits: [
        {
          objectID: '41141962',
          title: 'Tauri 2.0 Stable Release',
          url: 'https://v2.tauri.app/blog/tauri-20/',
          points: 1204,
          num_comments: 389,
          created_at: '2024-10-02T14:00:00Z',
        },
        { title: 'sans id' },
      ],
    },
    'api.github.com': {
      items: [
        {
          full_name: 'pdf-rs/pdf',
          html_url: 'https://github.com/pdf-rs/pdf',
          stargazers_count: 1512,
          language: 'Rust',
          description: 'Lecture de PDF en Rust',
          pushed_at: '2026-10-30T08:00:00Z',
        },
      ],
    },
    'api.stackexchange.com': {
      items: [
        {
          title: 'How to read a PDF in Rust&#39;s std?',
          link: 'https://stackoverflow.com/q/1',
          score: 12,
          answer_count: 3,
          is_answered: true,
          creation_date: 1_700_000_000,
        },
      ],
    },
    ...overrides,
  };
  const fetchJson = async (url: string): Promise<unknown> => {
    urls.push(url);
    const host = new URL(url).host;
    const data = responses[host];
    if (data instanceof Error) throw data;
    return data ?? {};
  };
  return { urls, fetchJson };
}

describe('searchWeb — quatre sources sans clé', () => {
  it('interroge les quatre sources et rend des résultats compacts', async () => {
    const { urls, fetchJson } = fakeApis();
    const result = await searchWeb('tauri pdf', undefined, { fetchJson, now: NOW });

    expect(urls.map(u => new URL(u).host).sort()).toEqual([
      'api.github.com',
      'api.stackexchange.com',
      'fr.wikipedia.org',
      'hn.algolia.com',
    ]);
    expect(result.echecs).toBeUndefined();
    expect(result.resultats.map(r => r.source)).toEqual([
      'wikipedia',
      'hackernews',
      'github',
      'stackoverflow',
    ]);
    const [wiki, hn, gh, so] = result.resultats;
    expect(wiki).toEqual({
      source: 'wikipedia',
      titre: 'Model Context Protocol',
      url: 'https://fr.wikipedia.org/wiki/Model_Context_Protocol',
      extrait: 'Protocole MCP publié par Anthropic & ouvert',
    });
    expect(hn).toMatchObject({
      url: 'https://news.ycombinator.com/item?id=41141962',
      date: '2024-10-02',
    });
    expect(hn?.info).toMatch(/1\s204 points, 389 commentaires/);
    expect(gh).toMatchObject({ titre: 'pdf-rs/pdf', date: '2026-10-30' });
    expect(gh?.info).toMatch(/1\s512 étoiles, Rust/);
    expect(so).toMatchObject({ titre: "How to read a PDF in Rust's std?", date: '2023-11-14' });
    expect(so?.info).toBe('score 12, 3 réponses, résolue');
  });

  it('passe en anglais quand Wikipédia en français ne trouve rien', async () => {
    const { urls, fetchJson } = fakeApis({ 'fr.wikipedia.org': { query: { search: [] } } });
    const result = await searchWeb('obscure', ['wikipedia'], { fetchJson, now: NOW });
    expect(urls.map(u => new URL(u).host)).toEqual(['fr.wikipedia.org', 'en.wikipedia.org']);
    expect(result.resultats[0]?.url).toBe('https://en.wikipedia.org/wiki/English_only');
  });

  it('filtre par date sur HN, GitHub et Stack Overflow', async () => {
    const { urls, fetchJson } = fakeApis();
    await searchWeb('tauri', undefined, { fetchJson, now: NOW, days: 30 });
    const since = Math.floor(NOW.getTime() / 1000) - 30 * 86_400;
    expect(urls.find(u => u.includes('algolia'))).toContain(`created_at_i>${since}`);
    expect(urls.find(u => u.includes('stackexchange'))).toContain(`fromdate=${since}`);
    expect(decodeURIComponent(urls.find(u => u.includes('github')) ?? '')).toContain(
      'pushed:>2026-10-22',
    );
    expect(urls.find(u => u.includes('wikipedia'))).not.toContain('2026');
  });

  it("une source en échec n'empêche pas les autres", async () => {
    const { fetchJson } = fakeApis({ 'api.github.com': new Error('HTTP 403') });
    const result = await searchWeb('tauri', undefined, { fetchJson, now: NOW });
    expect(result.echecs).toEqual(['github : HTTP 403']);
    expect(result.resultats.length).toBe(3);
  });

  it('masque les données personnelles avant que la requête sorte', async () => {
    const { urls, fetchJson } = fakeApis();
    const result = await searchWeb('qui appelle le 06 12 34 56 78 ?', ['hackernews'], {
      fetchJson,
      now: NOW,
    });
    expect(result.requete_masquee).toBe(true);
    expect(decodeURIComponent(urls.join(' '))).not.toMatch(/06 12 34 56 78/);
    expect(result.requete).not.toMatch(/06 12/);
  });

  it('une source seule rend plus de résultats que dans le mélange', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      objectID: String(i),
      title: `Story ${i}`,
      points: i,
      num_comments: 0,
    }));
    const { fetchJson } = fakeApis({ 'hn.algolia.com': { hits: many } });
    const alone = await searchWeb('x', ['hackernews'], { fetchJson, now: NOW });
    expect(alone.resultats.length).toBe(8);
    const mixed = await searchWeb('x', undefined, { fetchJson, now: NOW });
    expect(mixed.resultats.filter(r => r.source === 'hackernews').length).toBe(3);
  });
});

describe('capResults et cleanSnippet — la sortie reste courte', () => {
  it('retire des résultats par la fin pour tenir dans le plafond', () => {
    const hit = (i: number): WebHit => ({
      source: 'github',
      titre: `dépôt ${i}`,
      url: `https://github.com/x/${i}`,
      extrait: 'x'.repeat(600),
    });
    const capped = capResults({
      requete: 'q',
      resultats: Array.from({ length: 10 }, (_, i) => hit(i)),
    });
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(capped.coupe).toBe(true);
    expect(capped.resultats[0]?.titre).toBe('dépôt 0');
  });

  it('10 résultats au plus', () => {
    const hits = Array.from({ length: 14 }, (_, i) => ({
      source: 'hackernews' as const,
      titre: `t${i}`,
      url: `u${i}`,
    }));
    const capped = capResults({ requete: 'q', resultats: hits });
    expect(capped.resultats.length).toBe(10);
    expect(capped.coupe).toBe(true);
  });

  it('nettoie le HTML et coupe les extraits', () => {
    expect(cleanSnippet('a <b>gras</b>\n  et &quot;cité&quot; &#39;ici&#39;')).toBe(
      'a gras et "cité" \'ici\'',
    );
    const long = cleanSnippet('mot '.repeat(100), 40);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('search_web', () => {
  it('passe la source choisie et la fenêtre de jours', async () => {
    const calls: unknown[] = [];
    const tool = new SearchWebTool(async (query, sources, opts) => {
      calls.push({ query, sources, opts });
      return { requete: query, resultats: [{ source: 'github', titre: 't', url: 'u' }] };
    });
    expectOk(await tool.run({ query: '  tauri  ', source: 'github', days: 7 }));
    expect(calls).toEqual([{ query: 'tauri', sources: ['github'], opts: { days: 7 } }]);
  });

  it('échoue si toutes les sources sont tombées, pas sur un simple zéro résultat', async () => {
    const down = new SearchWebTool(async q => ({
      requete: q,
      resultats: [],
      echecs: ['wikipedia : x', 'hackernews : x', 'github : x', 'stackoverflow : x'],
    }));
    expect(expectFail(await down.run({ query: 'tauri' })).error).toMatch(/indisponible/);
    const empty = new SearchWebTool(async q => ({ requete: q, resultats: [] }));
    expect(expectOk(await empty.run({ query: 'tauri' })).data).toMatchObject({
      note: expect.stringMatching(/Aucun résultat/),
    });
  });

  it('refuse une requête vide ou une source inconnue', async () => {
    const tool = new SearchWebTool(async q => ({ requete: q, resultats: [] }));
    expectFail(await tool.run({ query: ' ' }));
    expectFail(await tool.run({ query: 'tauri', source: 'reddit' }));
    expectFail(await tool.run({ query: 'tauri', days: 0 }));
  });
});
