import { z } from 'zod';
import { ghFetch, ghFetchText, validateRepo } from '../../lib/githubApi';
import { httpGet } from '../../lib/http';
import { cutAtSentence } from '../newsText';
import {
  DOMAIN_KEYWORDS,
  DOMAIN_TOPICS,
  TRENDING_PAGES,
  VEILLE_DOMAINS,
  WATCHED_REPOS,
  type VeilleDomain,
} from './veilleSources';

// Collecte de la veille GitHub : aucun LLM ici. Le tri grossier, tout ce qui se
// vérifie par un chiffre, est fait par ce code ; Claude reçoit les dossiers et
// ne fait que juger et résumer (.github/workflows/ai-veille.yml).

/** Fichiers d'échange avec Claude, dans VEILLE_WORKDIR. */
export const CANDIDATES_FILE = 'candidates.json';
export const RELEASES_FILE = 'releases.json';
export const REPORT_FILE = 'veille.json';

/** En dessous, un dépôt créé dans la fenêtre n'a encore convaincu personne. */
const MIN_STARS = 15;
const README_MAX_CHARS = 12_000;
const EXCERPT_MAX_CHARS = 300;
const RELEASE_NOTES_MAX_CHARS = 1_500;
/** Sans version connue (premier run), seule une sortie récente compte. */
const FIRST_RUN_RELEASE_DAYS = 3;
const DAY_MS = 86_400_000;

const RepoSchema = z.object({
  full_name: z.string(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  topics: z.array(z.string()).default([]),
  stargazers_count: z.number(),
  forks_count: z.number(),
  created_at: z.string(),
  pushed_at: z.string(),
  archived: z.boolean(),
  fork: z.boolean(),
  license: z.object({ spdx_id: z.string().nullable() }).nullable(),
});

const SearchSchema = z.object({ items: z.array(RepoSchema) });

const ReleaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.string(),
  published_at: z.string().nullable(),
  body: z.string().nullable(),
});

export type GithubRepo = z.infer<typeof RepoSchema>;
export type GithubRelease = z.infer<typeof ReleaseSchema>;

export type LicenseKind = 'libre' | 'copyleft' | 'inconnue';

/** Un dépôt proposé à Claude (fichier candidates.json). */
export interface RepoCandidate {
  /** Identifiant court (r1, r2…) pour s'y référer dans la consigne. */
  id: string;
  repo: string;
  domain: VeilleDomain;
  via: 'recherche' | 'trending';
  description: string;
  language: string | null;
  topics: string[];
  stars: number;
  forks: number;
  ageDays: number;
  starsPerDay: number;
  pushedAt: string;
  license: string | null;
  licenseKind: LicenseKind;
  /** Popularité sans rapport avec l'usage réel : à vérifier, pas un rejet. */
  suspect: boolean;
  /** Personnes ayant commité (plafonné à 100) ; null si GitHub ne le dit pas. */
  contributors: number | null;
  /** README, relatif à VEILLE_WORKDIR ; null si le dépôt n'en a pas. */
  readmeFile: string | null;
  excerpt: string;
}

/** Une nouvelle version d'une brique suivie (fichier releases.json). */
export interface WatchedRelease {
  repo: string;
  version: string;
  url: string;
  publishedAt: string | null;
  notes: string;
}

/** Ce qui survit d'un run à l'autre, dans l'artefact `veille-archive`. */
export const VeilleStateSchema = z.object({
  repos: z.record(z.object({ firstSeen: z.string(), stars: z.number() })),
  releases: z.record(z.string()),
});

export type VeilleState = z.infer<typeof VeilleStateSchema>;

export const EMPTY_STATE: VeilleState = { repos: {}, releases: {} };

const LIBRE = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'Zlib',
  'BSL-1.0',
]);

/**
 * Peut-on en reprendre du code dans un binaire distribué ? `copyleft` : on s'en
 * inspire, on ne copie pas (`worldmonitor`, AGPL, analyse du 2026-08-16). Pur.
 */
export function licenseKind(spdx: string | null): LicenseKind {
  if (spdx === null) return 'inconnue';
  if (LIBRE.has(spdx)) return 'libre';
  return /^(A?GPL|LGPL|MPL|EUPL|OSL|CC-BY-SA)/i.test(spdx) ? 'copyleft' : 'inconnue';
}

/**
 * Un dépôt jeune dont les chiffres ne ressemblent pas à un usage réel. Sans
 * forks, c'est le profil des fausses étoiles, parfois piégées (collecte du
 * 2026-11-06 : ~35 ★, 0 fork, pseudo généré, pas de README, promesse d'un
 * « autopilot Windows »). Avec trop de forks, c'est un réseau de comptes (427 ★,
 * 260 forks en un jour). Un signal à vérifier, pas un rejet. Pur, exporté pour
 * tests.
 */
export function isSuspect(r: { stars: number; forks: number; ageDays: number }): boolean {
  if (r.ageDays > 180) return false;
  if (r.forks === 0) return r.stars >= 25;
  const ratio = r.forks / r.stars;
  return (r.stars >= 200 && ratio < 0.02) || (r.stars >= 50 && ratio > 0.5);
}

function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text);
}

/** Domaine d'un dépôt d'après ses mots ; null = hors périmètre. Pur, exporté pour tests. */
export function classifyDomain(text: string): VeilleDomain | null {
  const lower = text.toLowerCase();
  for (const domain of VEILLE_DOMAINS) {
    if (DOMAIN_KEYWORDS[domain].some(word => hasWord(lower, word))) return domain;
  }
  return null;
}

/** Dépôts d'une page Trending, sans doublon. GitHub n'en publie pas d'API. Pur. */
export function parseTrending(html: string): string[] {
  const found = html.matchAll(/<h2[^>]*>\s*<a[^>]*href="\/([\w.-]+\/[\w.-]+)"/g);
  return [...new Set([...found].map(m => m[1] ?? ''))].filter(validateRepo);
}

/** À montrer ? Jamais vu, ou revenu avec deux fois plus d'étoiles. Pur. */
export function isFresh(state: VeilleState, repo: string, stars: number): boolean {
  const seen = state.repos[repo];
  return seen === undefined || stars >= seen.stars * 2;
}

/** Version à signaler ? Pur, exporté pour tests. */
export function isNewRelease(
  knownTag: string | undefined,
  release: Pick<GithubRelease, 'tag_name' | 'published_at'>,
  now: Date,
): boolean {
  if (knownTag !== undefined) return knownTag !== release.tag_name;
  if (release.published_at === null) return false;
  const age = now.getTime() - Date.parse(release.published_at);
  return age <= FIRST_RUN_RELEASE_DAYS * DAY_MS;
}

/** Retire d'un README ce qui ne se lit pas (images, badges, HTML). Pur. */
export function cleanReadme(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toCandidate(
  r: GithubRepo,
  domain: VeilleDomain,
  via: RepoCandidate['via'],
  now: Date,
): RepoCandidate {
  const ageDays = Math.max(1, Math.round((now.getTime() - Date.parse(r.created_at)) / DAY_MS));
  const spdx = r.license?.spdx_id ?? null;
  const license = spdx === 'NOASSERTION' ? null : spdx;
  const stars = r.stargazers_count;
  return {
    id: '',
    repo: r.full_name,
    domain,
    via,
    description: (r.description ?? '').slice(0, 300),
    language: r.language,
    topics: r.topics.slice(0, 12),
    stars,
    forks: r.forks_count,
    ageDays,
    starsPerDay: Math.round((stars / ageDays) * 10) / 10,
    pushedAt: r.pushed_at,
    license,
    licenseKind: licenseKind(license),
    suspect: isSuspect({ stars, forks: r.forks_count, ageDays }),
    contributors: null,
    readmeFile: null,
    excerpt: '',
  };
}

/**
 * Rang d'un candidat dans son domaine : l'élan, pas la taille, sans quoi les
 * grands classiques qui passent par Trending prennent la place des nouveautés.
 */
function score(c: RepoCandidate): number {
  const momentum = Math.log2(1 + c.starsPerDay) + (c.via === 'trending' ? 3 : 0);
  return momentum * (c.suspect ? 0.5 : 1);
}

/**
 * Meilleurs candidats de chaque domaine, à quota égal : un domaine bruyant ne
 * doit pas écraser les autres. Pur, exporté pour tests.
 */
export function pickCandidates(all: RepoCandidate[], perDomain: number): RepoCandidate[] {
  const picked = VEILLE_DOMAINS.flatMap(domain =>
    all
      .filter(c => c.domain === domain)
      .sort((a, b) => score(b) - score(a))
      .slice(0, perDomain),
  );
  return picked.map((c, i) => ({ ...c, id: `r${i + 1}` }));
}

/** État après un rapport envoyé : on ne remontre plus ce qui a été présenté. Pur. */
export function markSeen(
  state: VeilleState,
  candidates: readonly Pick<RepoCandidate, 'repo' | 'stars'>[],
  releases: readonly Pick<WatchedRelease, 'repo' | 'version'>[],
  date: string,
): VeilleState {
  const repos = { ...state.repos };
  for (const c of candidates) {
    repos[c.repo] = { firstSeen: repos[c.repo]?.firstSeen ?? date, stars: c.stars };
  }
  const known = { ...state.releases };
  for (const r of releases) known[r.repo] = r.version;
  return { repos, releases: known };
}

/** Accès à GitHub, injecté pour que la collecte se teste sans réseau. */
export interface GithubSource {
  searchRepos(query: string): Promise<GithubRepo[]>;
  getRepo(repo: string): Promise<GithubRepo | null>;
  latestRelease(repo: string): Promise<GithubRelease | null>;
  readme(repo: string): Promise<string | null>;
  contributors(repo: string): Promise<number | null>;
  trendingHtml(url: string): Promise<string>;
}

/** Les erreurs de l'API GitHub reviennent en JSON (`message`), pas en exception. */
export function githubSource(token: string): GithubSource {
  return {
    async searchRepos(query) {
      const q = encodeURIComponent(query);
      const body = await ghFetch(
        `/search/repositories?q=${q}&sort=stars&order=desc&per_page=20`,
        token,
      );
      const parsed = SearchSchema.safeParse(body);
      if (!parsed.success) throw new Error(`Recherche GitHub refusée : ${apiMessage(body)}`);
      return parsed.data.items;
    },
    async getRepo(repo) {
      const parsed = RepoSchema.safeParse(await ghFetch(`/repos/${repo}`, token));
      return parsed.success ? parsed.data : null;
    },
    async latestRelease(repo) {
      const parsed = ReleaseSchema.safeParse(
        await ghFetch(`/repos/${repo}/releases/latest`, token),
      );
      return parsed.success ? parsed.data : null;
    },
    async readme(repo) {
      const text = await ghFetchText(
        `/repos/${repo}/readme`,
        token,
        'application/vnd.github.raw+json',
      );
      return text.startsWith('{"message"') ? null : text;
    },
    async contributors(repo) {
      const body = await ghFetch(`/repos/${repo}/contributors?per_page=100`, token);
      return Array.isArray(body) ? body.length : null;
    },
    trendingHtml: url => httpGet(url, 20_000),
  };
}

function apiMessage(body: unknown): string {
  const parsed = z.object({ message: z.string() }).safeParse(body);
  return parsed.success ? parsed.data.message : 'réponse inattendue';
}

export interface CollectInput {
  state: VeilleState;
  now: Date;
  /** Âge maximal d'un dépôt trouvé par recherche. */
  windowDays: number;
  perDomain: number;
  /** Pause entre deux recherches : l'API en accepte 30 par minute. */
  pauseMs: number;
}

export interface CollectResult {
  candidates: RepoCandidate[];
  releases: WatchedRelease[];
  /** README nettoyés, par `readmeFile`. */
  readmes: Map<string, string>;
  /** Sources en échec, et nombre de sources interrogées. */
  failed: string[];
  queried: number;
}

function readmeFileName(repo: string): string {
  return `readmes/${repo.replace('/', '__')}.md`;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Interroge GitHub et prépare les dossiers. Une source en échec n'arrête pas les autres. */
export async function collectRepos(
  source: GithubSource,
  input: CollectInput,
): Promise<CollectResult> {
  const { state, now } = input;
  const found = new Map<string, RepoCandidate>();
  const failed: string[] = [];
  let queried = 0;

  const add = (r: GithubRepo, domain: VeilleDomain, via: RepoCandidate['via']): void => {
    if (r.archived || r.fork || !isFresh(state, r.full_name, r.stargazers_count)) return;
    const known = found.get(r.full_name);
    // Trouvé des deux côtés : Trending est le signal le plus fort.
    if (known === undefined || via === 'trending') {
      found.set(r.full_name, toCandidate(r, known?.domain ?? domain, via, now));
    }
  };

  const since = isoDay(new Date(now.getTime() - input.windowDays * DAY_MS));
  for (const domain of VEILLE_DOMAINS) {
    for (const topic of DOMAIN_TOPICS[domain]) {
      queried += 1;
      try {
        const query = `topic:${topic} created:>=${since} stars:>=${MIN_STARS}`;
        for (const r of await source.searchRepos(query)) add(r, domain, 'recherche');
      } catch {
        failed.push(`topic:${topic}`);
      }
      await new Promise(resolve => setTimeout(resolve, input.pauseMs));
    }
  }

  for (const page of TRENDING_PAGES) {
    queried += 1;
    try {
      for (const name of parseTrending(await source.trendingHtml(page))) {
        const r = await source.getRepo(name);
        if (r === null) continue;
        const words = [r.full_name, r.description ?? '', ...r.topics].join(' ');
        const domain = classifyDomain(words);
        if (domain !== null) add(r, domain, 'trending');
      }
    } catch {
      failed.push(page);
    }
  }

  const releases: WatchedRelease[] = [];
  for (const repo of WATCHED_REPOS) {
    queried += 1;
    try {
      const release = await source.latestRelease(repo);
      if (release === null || !isNewRelease(state.releases[repo], release, now)) continue;
      releases.push({
        repo,
        version: release.tag_name,
        url: release.html_url,
        publishedAt: release.published_at,
        notes: cutAtSentence(cleanReadme(release.body ?? ''), RELEASE_NOTES_MAX_CHARS),
      });
    } catch {
      failed.push(`release:${repo}`);
    }
  }

  const candidates = pickCandidates([...found.values()], input.perDomain);
  const readmes = new Map<string, string>();
  for (const c of candidates) {
    try {
      const raw = await source.readme(c.repo);
      if (raw !== null) {
        const text = cleanReadme(raw);
        c.readmeFile = readmeFileName(c.repo);
        c.excerpt = cutAtSentence(text, EXCERPT_MAX_CHARS);
        readmes.set(c.readmeFile, text.slice(0, README_MAX_CHARS));
      }
      c.contributors = await source.contributors(c.repo);
    } catch {
      failed.push(`dossier:${c.repo}`);
    }
  }

  return { candidates, releases, readmes, failed, queried };
}
