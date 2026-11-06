import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE,
  classifyDomain,
  cleanReadme,
  collectRepos,
  isFresh,
  isNewRelease,
  isSuspect,
  licenseKind,
  markSeen,
  parseTrending,
  pickCandidates,
  type GithubRepo,
  type GithubSource,
  type RepoCandidate,
} from './collectRepos';
import { VEILLE_DOMAINS, WATCHED_REPOS } from './veilleSources';

const NOW = new Date('2026-11-06T05:00:00Z');

function repo(name: string, over: Partial<GithubRepo> = {}): GithubRepo {
  return {
    full_name: name,
    description: 'Un dépôt',
    language: 'TypeScript',
    topics: [],
    stargazers_count: 100,
    forks_count: 10,
    created_at: '2026-11-01T00:00:00Z',
    pushed_at: '2026-11-05T00:00:00Z',
    archived: false,
    fork: false,
    license: { spdx_id: 'MIT' },
    ...over,
  };
}

function candidate(over: Partial<RepoCandidate>): RepoCandidate {
  return {
    id: '',
    repo: 'a/b',
    domain: 'Moteur local',
    via: 'recherche',
    description: '',
    language: null,
    topics: [],
    stars: 100,
    forks: 10,
    ageDays: 10,
    starsPerDay: 10,
    pushedAt: '2026-11-05T00:00:00Z',
    license: 'MIT',
    licenseKind: 'libre',
    suspect: false,
    contributors: null,
    readmeFile: null,
    excerpt: '',
    ...over,
  };
}

function source(over: Partial<GithubSource> = {}): GithubSource {
  return {
    searchRepos: () => Promise.resolve([]),
    getRepo: () => Promise.resolve(null),
    latestRelease: () => Promise.resolve(null),
    readme: () => Promise.resolve(null),
    contributors: () => Promise.resolve(null),
    trendingHtml: () => Promise.resolve(''),
    ...over,
  };
}

const INPUT = { state: EMPTY_STATE, now: NOW, windowDays: 14, perDomain: 15, pauseMs: 0 };

describe('licenseKind', () => {
  it('sépare ce qu’on peut copier de ce dont on s’inspire', () => {
    expect(licenseKind('MIT')).toBe('libre');
    expect(licenseKind('Apache-2.0')).toBe('libre');
    expect(licenseKind('AGPL-3.0')).toBe('copyleft');
    expect(licenseKind('GPL-3.0')).toBe('copyleft');
    expect(licenseKind('LGPL-2.1')).toBe('copyleft');
    expect(licenseKind('MPL-2.0')).toBe('copyleft');
  });

  it('une licence absente ou maison reste inconnue', () => {
    expect(licenseKind(null)).toBe('inconnue');
    expect(licenseKind('LicenseRef-Proprietary')).toBe('inconnue');
  });
});

describe('isSuspect', () => {
  it('étoiles sans aucun fork : le profil des fausses étoiles', () => {
    expect(isSuspect({ stars: 33, forks: 0, ageDays: 6 })).toBe(true);
  });

  it('beaucoup d’étoiles et presque aucun fork', () => {
    expect(isSuspect({ stars: 2724, forks: 42, ageDays: 10 })).toBe(true);
  });

  it('plus d’un fork pour deux étoiles : un réseau de comptes', () => {
    expect(isSuspect({ stars: 427, forks: 260, ageDays: 1 })).toBe(true);
  });

  it('un jeune dépôt sain ou encore confidentiel passe', () => {
    expect(isSuspect({ stars: 838, forks: 60, ageDays: 10 })).toBe(false);
    expect(isSuspect({ stars: 18, forks: 0, ageDays: 1 })).toBe(false);
    expect(isSuspect({ stars: 20, forks: 15, ageDays: 3 })).toBe(false);
  });

  it('l’âge prouve l’usage : un vieux dépôt n’est jamais suspect', () => {
    expect(isSuspect({ stars: 5000, forks: 0, ageDays: 400 })).toBe(false);
  });
});

describe('classifyDomain', () => {
  it('reconnaît un domaine à ses mots', () => {
    expect(classifyDomain('A server for the Model Context Protocol')).toBe('Skills et MCP');
    expect(classifyDomain('run llama.cpp on Vulkan')).toBe('Moteur local');
    expect(classifyDomain('self-hosted RSS reader')).toBe('Presse et bourse');
  });

  it('mots entiers : `rag` ne prend pas storage, ni `tts` settings', () => {
    expect(classifyDomain('object storage with fragile settings')).toBeNull();
  });

  it('hors périmètre : null', () => {
    expect(classifyDomain('rails/rails Ruby on Rails web framework')).toBeNull();
  });
});

describe('parseTrending', () => {
  const article = (name: string) =>
    `<article class="Box-row"><h2 class="h3 lh-condensed">\n  <a href="/${name}" data-view-component="true" class="Link">x</a></h2></article>`;

  it('lit les dépôts sans doublon', () => {
    const html =
      article('zed-industries/zed') + article('google/skills') + article('google/skills');
    expect(parseTrending(html)).toEqual(['zed-industries/zed', 'google/skills']);
  });

  it('ignore les autres liens, et une page vide ne casse rien', () => {
    expect(parseTrending('<a href="/login">Sign in</a><h2>Trending</h2>')).toEqual([]);
    expect(parseTrending('')).toEqual([]);
  });
});

describe('isFresh', () => {
  const state = { repos: { 'a/b': { firstSeen: '2026-11-01', stars: 100 } }, releases: {} };

  it('un dépôt jamais vu est à montrer', () => {
    expect(isFresh(state, 'c/d', 10)).toBe(true);
  });

  it('un dépôt vu ne revient que si ses étoiles ont doublé', () => {
    expect(isFresh(state, 'a/b', 199)).toBe(false);
    expect(isFresh(state, 'a/b', 200)).toBe(true);
  });
});

describe('isNewRelease', () => {
  const release = (tag: string, published: string | null) => ({
    tag_name: tag,
    published_at: published,
  });

  it('version connue : compare les tags', () => {
    expect(isNewRelease('v1', release('v2', '2026-01-01T00:00:00Z'), NOW)).toBe(true);
    expect(isNewRelease('v2', release('v2', '2026-11-06T00:00:00Z'), NOW)).toBe(false);
  });

  it('premier run : seule une sortie récente compte', () => {
    expect(isNewRelease(undefined, release('v1', '2026-11-04T00:00:00Z'), NOW)).toBe(true);
    expect(isNewRelease(undefined, release('v1', '2026-10-01T00:00:00Z'), NOW)).toBe(false);
    expect(isNewRelease(undefined, release('v1', null), NOW)).toBe(false);
  });
});

describe('cleanReadme', () => {
  it('retire images, badges, HTML et commentaires, garde le texte', () => {
    const md =
      '<!-- caché -->\n[![CI](https://x/b.svg)](https://x)\n![logo](l.png)\n<p align="center">Bonjour</p>\n\n\n\n[lien](https://y)';
    expect(cleanReadme(md)).toBe('Bonjour\n\n[lien](https://y)');
  });
});

describe('pickCandidates', () => {
  it('quota par domaine : un domaine bruyant n’écrase pas les autres', () => {
    const noisy = Array.from({ length: 5 }, (_, i) =>
      candidate({ repo: `n/${i}`, domain: 'Skills et MCP', starsPerDay: 1000 }),
    );
    const quiet = candidate({ repo: 'q/1', domain: 'Presse et bourse', starsPerDay: 1 });
    const picked = pickCandidates([...noisy, quiet], 2);
    expect(picked.map(c => c.domain)).toEqual([
      'Skills et MCP',
      'Skills et MCP',
      'Presse et bourse',
    ]);
  });

  it('classe à l’élan, pas à la taille', () => {
    const old = candidate({ repo: 'old/big', stars: 100_000, starsPerDay: 5 });
    const rising = candidate({ repo: 'new/hot', stars: 500, starsPerDay: 100 });
    expect(pickCandidates([old, rising], 1)[0]?.repo).toBe('new/hot');
  });

  it('un suspect passe derrière un dépôt sain de même élan', () => {
    const fake = candidate({ repo: 'f/ake', starsPerDay: 100, suspect: true });
    const real = candidate({ repo: 'r/eal', starsPerDay: 50 });
    expect(pickCandidates([fake, real], 1)[0]?.repo).toBe('r/eal');
  });

  it('numérote r1, r2… dans l’ordre', () => {
    const picked = pickCandidates(
      [candidate({ repo: 'a/1' }), candidate({ repo: 'a/2', domain: 'Skills et MCP' })],
      5,
    );
    expect(picked.map(c => c.id)).toEqual(['r1', 'r2']);
  });
});

describe('markSeen', () => {
  it('garde la première date, met à jour les étoiles et les versions', () => {
    const before = { repos: { 'a/b': { firstSeen: '2026-11-01', stars: 10 } }, releases: {} };
    const after = markSeen(
      before,
      [
        { repo: 'a/b', stars: 40 },
        { repo: 'c/d', stars: 5 },
      ],
      [{ repo: 'ollama/ollama', version: 'v1' }],
      '2026-11-06',
    );
    expect(after.repos['a/b']).toEqual({ firstSeen: '2026-11-01', stars: 40 });
    expect(after.repos['c/d']).toEqual({ firstSeen: '2026-11-06', stars: 5 });
    expect(after.releases['ollama/ollama']).toBe('v1');
  });

  it('ne touche pas à l’état reçu', () => {
    const before = { repos: {}, releases: {} };
    markSeen(before, [{ repo: 'a/b', stars: 1 }], [], '2026-11-06');
    expect(before.repos).toEqual({});
  });
});

describe('collectRepos', () => {
  it('écarte forks, archivés et déjà vus', async () => {
    const result = await collectRepos(
      source({
        searchRepos: () =>
          Promise.resolve([
            repo('ok/new'),
            repo('x/fork', { fork: true }),
            repo('x/archived', { archived: true }),
            repo('x/seen'),
          ]),
      }),
      { ...INPUT, state: { repos: { 'x/seen': { firstSeen: 'x', stars: 100 } }, releases: {} } },
    );
    expect(result.candidates.map(c => c.repo)).toEqual(['ok/new']);
  });

  it('Trending : garde ce qui entre dans un domaine, écarte le reste', async () => {
    const html = (name: string) => `<h2 class="h3"><a href="/${name}">x</a></h2>`;
    const result = await collectRepos(
      source({
        trendingHtml: () => Promise.resolve(html('rails/rails') + html('foo/agent-tool')),
        getRepo: name =>
          Promise.resolve(
            name === 'rails/rails'
              ? repo(name, { description: 'Ruby web framework' })
              : repo(name, { description: 'An MCP server' }),
          ),
      }),
      INPUT,
    );
    expect(result.candidates.map(c => c.repo)).toEqual(['foo/agent-tool']);
    expect(result.candidates[0]?.via).toBe('trending');
    expect(result.candidates[0]?.domain).toBe('Skills et MCP');
  });

  it('une source en échec n’arrête pas les autres, et se compte', async () => {
    let calls = 0;
    const result = await collectRepos(
      source({
        searchRepos: () => {
          calls += 1;
          return calls === 1 ? Promise.reject(new Error('403')) : Promise.resolve([repo('ok/new')]);
        },
      }),
      INPUT,
    );
    expect(result.failed).toHaveLength(1);
    expect(result.candidates.map(c => c.repo)).toEqual(['ok/new']);
    expect(result.queried).toBeGreaterThan(VEILLE_DOMAINS.length);
  });

  it('prépare le dossier : README nettoyé, extrait, contributeurs', async () => {
    const result = await collectRepos(
      source({
        searchRepos: () => Promise.resolve([repo('ok/new')]),
        readme: () => Promise.resolve('![l](l.png)\nUn outil utile.'),
        contributors: () => Promise.resolve(3),
      }),
      INPUT,
    );
    const c = result.candidates[0];
    expect(c?.readmeFile).toBe('readmes/ok__new.md');
    expect(c?.excerpt).toBe('Un outil utile.');
    expect(c?.contributors).toBe(3);
    expect(result.readmes.get('readmes/ok__new.md')).toBe('Un outil utile.');
  });

  it('calcule l’âge, l’élan et la licence ; NOASSERTION reste inconnue', async () => {
    const result = await collectRepos(
      source({
        searchRepos: () =>
          Promise.resolve([
            repo('ok/new', {
              stargazers_count: 50,
              created_at: '2026-11-01T05:00:00Z',
              license: { spdx_id: 'NOASSERTION' },
            }),
          ]),
      }),
      INPUT,
    );
    const c = result.candidates[0];
    expect(c?.ageDays).toBe(5);
    expect(c?.starsPerDay).toBe(10);
    expect(c?.license).toBeNull();
    expect(c?.licenseKind).toBe('inconnue');
  });

  it('signale une nouvelle version d’une brique suivie, pas une déjà connue', async () => {
    const [first, second] = WATCHED_REPOS;
    const result = await collectRepos(
      source({
        latestRelease: name =>
          Promise.resolve(
            name === first || name === second
              ? {
                  tag_name: 'v2',
                  html_url: `https://github.com/${name}/releases/tag/v2`,
                  published_at: '2026-01-01T00:00:00Z',
                  body: 'Notes',
                }
              : null,
          ),
      }),
      { ...INPUT, state: { repos: {}, releases: { [first ?? '']: 'v1', [second ?? '']: 'v2' } } },
    );
    expect(result.releases.map(r => r.repo)).toEqual([first]);
    expect(result.releases[0]?.notes).toBe('Notes');
  });
});
