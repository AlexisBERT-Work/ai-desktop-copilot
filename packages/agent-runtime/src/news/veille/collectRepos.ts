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
import { RETURNABLE_CAUSE, type VeilleRejected } from './veilleSchema';

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
/** Au-delà, l'âge prouve l'usage : plus aucun signal de spam ne vaut. */
const SUSPECT_MAX_AGE_DAYS = 180;
/**
 * Délai avant qu'un dépôt déjà présenté revienne, même ses étoiles doublées :
 * un dépôt de deux jours les double du jour au lendemain. Du 6 au 20/11/2026,
 * les 19 retours d'écartés sont tous survenus moins de 7 jours après le passage
 * précédent.
 */
export const RETURN_AFTER_DAYS = 7;
/** Une série de clones : au moins trois dépôts nés le même jour qui se ressemblent. */
const SERIES_MIN = 3;
/** Part des mots communs au-delà de laquelle deux textes sont le même, nom changé. */
const SAME_DESCRIPTION = 0.7;
const SAME_README = 0.6;
/** Sous ces tailles, deux textes courts se ressemblent par hasard (« An MCP server for… »). */
const DESCRIPTION_MIN_WORDS = 8;
const README_MIN_WORDS = 40;
/**
 * Un plan de README identique trahit un gabarit rempli par un générateur : la
 * série Blender du 12/11/2026 avait des textes différents (60 % de mots en
 * commun au plus) mais les 11 mêmes intertitres. En dessous de 6, des
 * intertitres courants (Installation, Usage, License) se croisent par hasard.
 */
const SKELETON_MIN_HEADINGS = 6;

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

/** Un dépôt d'une série de clones, que son représentant remplace dans les dossiers. */
export interface CloneRef {
  repo: string;
  stars: number;
}

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
  createdAt: string;
  ageDays: number;
  starsPerDay: number;
  pushedAt: string;
  license: string | null;
  licenseKind: LicenseKind;
  /**
   * Un signal de spam au moins : popularité sans rapport avec l'usage réel,
   * série de clones, ou appât d'installation sur un dépôt jeune et solitaire. À
   * vérifier, pas un rejet.
   */
  suspect: boolean;
  /**
   * Autres dépôts de la même série (nés le même jour, même description ou même
   * README) : ils ne sont pas proposés, celui-ci les représente.
   */
  clones: CloneRef[];
  /** Le README pousse à lancer un script PowerShell téléchargé ou un exécutable. */
  installBait: boolean;
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

/**
 * Ce qui survit d'un run à l'autre, dans l'artefact `veille-archive`. Les champs
 * optionnels datent du 2026-11-21 : un `vus.json` plus ancien se relit tel quel.
 */
export const VeilleStateSchema = z.object({
  repos: z.record(
    z.object({
      firstSeen: z.string(),
      /** Dernier jour où il a été présenté ; à défaut, firstSeen. */
      lastSeen: z.string().optional(),
      stars: z.number(),
      /**
       * Écarté par le dernier rapport qui l'a présenté. Une chaîne et non la
       * liste des causes : retirer une cause du schéma ne doit pas rendre
       * l'archive illisible.
       */
      rejected: z.object({ cause: z.string(), day: z.string() }).optional(),
    }),
  ),
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
  if (r.ageDays > SUSPECT_MAX_AGE_DAYS) return false;
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

/**
 * À montrer ? Jamais vu, ou revenu avec deux fois plus d'étoiles au moins
 * RETURN_AFTER_DAYS après son dernier passage. Un écarté ne revient jamais, sauf
 * pour la cause `trop_jeune`. Pur.
 */
export function isFresh(state: VeilleState, repo: string, stars: number, now: Date): boolean {
  const seen = state.repos[repo];
  if (seen === undefined) return true;
  if (seen.rejected !== undefined && seen.rejected.cause !== RETURNABLE_CAUSE) return false;
  const days = (now.getTime() - Date.parse(seen.lastSeen ?? seen.firstSeen)) / DAY_MS;
  return stars >= seen.stars * 2 && days >= RETURN_AFTER_DAYS;
}

// ─── Signaux de spam lus dans les textes ────────────────────────────────────

/** Mots d'un texte, sans accents ni casse, dans l'ordre. */
function words(text: string, minLength: number): string[] {
  const plain = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return (plain.match(/[a-z0-9]+/g) ?? []).filter(w => w.length >= minLength);
}

function wordSet(text: string): Set<string> {
  return new Set(words(text, 3));
}

/** Part des mots communs (indice de Jaccard), 0 si l'un des ensembles est vide. */
function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common += 1;
  return common / (a.size + b.size - common);
}

/** Part des mots communs à deux textes, de 0 à 1. Pur, exporté pour tests. */
export function textSimilarity(a: string, b: string): number {
  return overlap(wordSet(a), wordSet(b));
}

/**
 * Plan d'un README : ses intertitres sous le titre (qui porte le nom du dépôt),
 * normalisés. Vide sous SKELETON_MIN_HEADINGS. Pur, exporté pour tests.
 */
export function readmeSkeleton(markdown: string): string {
  const headings = [...markdown.matchAll(/^#{2,6}[ \t]+(.+)$/gm)]
    .map(m => words(m[1] ?? '', 1).join(' '))
    .filter(h => h !== '');
  return headings.length >= SKELETON_MIN_HEADINGS ? headings.join('\n') : '';
}

/** Ce qu'il faut pour reconnaître une série. */
export interface SeriesMember {
  repo: string;
  createdAt: string;
  description: string;
  /** README nettoyé ; null tant qu'il n'est pas lu (avant le choix des dossiers). */
  readme: string | null;
}

interface SeriesFeatures {
  repo: string;
  day: string;
  description: Set<string>;
  readme: Set<string>;
  skeleton: string;
}

function features(m: SeriesMember): SeriesFeatures {
  const description = wordSet(m.description);
  const readme = m.readme === null ? new Set<string>() : wordSet(m.readme);
  return {
    repo: m.repo,
    day: m.createdAt.slice(0, 10),
    description: description.size >= DESCRIPTION_MIN_WORDS ? description : new Set(),
    readme: readme.size >= README_MIN_WORDS ? readme : new Set(),
    skeleton: m.readme === null ? '' : readmeSkeleton(m.readme),
  };
}

/** Nés le même jour, avec la même description ou le même README. */
function sameMold(a: SeriesFeatures, b: SeriesFeatures): boolean {
  if (a.day !== b.day) return false;
  return (
    overlap(a.description, b.description) >= SAME_DESCRIPTION ||
    overlap(a.readme, b.readme) >= SAME_README ||
    (a.skeleton !== '' && a.skeleton === b.skeleton)
  );
}

/**
 * Séries de clones : dépôts nés le même jour avec la même description ou le
 * même README (même texte, nom changé, ou même plan), reliés de proche en
 * proche. Une paire ne suffit pas : il en faut SERIES_MIN. Le profil d'un
 * réseau de comptes (série Blender du 12/11/2026 : 8 dépôts, 8 comptes, ~500 ★
 * chacun, créés en dix minutes). Pur, exporté pour tests.
 */
export function findCloneSeries(members: readonly SeriesMember[]): string[][] {
  const items = members.map(features);
  const parent = items.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  items.forEach((a, i) => {
    for (let j = i + 1; j < items.length; j++) {
      if (sameMold(a, items[j]!)) parent[root(j)] = root(i);
    }
  });
  const groups = new Map<number, string[]>();
  items.forEach((item, i) => {
    const r = root(i);
    groups.set(r, [...(groups.get(r) ?? []), item.repo]);
  });
  return [...groups.values()].filter(g => g.length >= SERIES_MIN);
}

/**
 * Une série ne garde qu'un dossier, celui du meilleur rang : les autres
 * prendraient la place de vrais candidats. Il porte la liste des clones et le
 * signal `suspect`. L'ordre des survivants est conservé. Pur, exporté pour tests.
 */
export function collapseSeries(
  candidates: readonly RepoCandidate[],
  series: readonly string[][],
): RepoCandidate[] {
  const keep = new Map<string, RepoCandidate>();
  const dropped = new Set<string>();
  for (const names of series) {
    const members = candidates.filter(c => names.includes(c.repo));
    const best = members.reduce((a, b) => (score(b) > score(a) ? b : a));
    const others = members.filter(c => c !== best);
    const clones = [best, ...others].flatMap(c => c.clones);
    clones.push(...others.map(c => ({ repo: c.repo, stars: c.stars })));
    keep.set(best.repo, { ...best, suspect: true, clones });
    for (const c of others) dropped.add(c.repo);
  }
  return candidates.filter(c => !dropped.has(c.repo)).map(c => keep.get(c.repo) ?? c);
}

/**
 * Une ligne qui télécharge puis exécute : `irm … | iex`, `iex (iwr …)`,
 * `DownloadFile(…) ; Start-Process`.
 */
const DOWNLOAD_AND_RUN =
  /^(?=.*\b(?:irm|iwr|curl|wget|invoke-restmethod|invoke-webrequest|downloadstring|downloadfile|start-bitstransfer)\b)(?=.*\b(?:iex|invoke-expression|start-process)\b)/im;
/** Un lien (Markdown, référence ou HTML) vers un exécutable Windows. */
const EXECUTABLE_LINK =
  /(?:\]\(\s*<?|^\s*\[[^\]]+\]:\s*<?|href\s*=\s*["']?)[^\s)"'<>]+\.(?:exe|msi|msix|appx|scr|bat|cmd|vbs)(?=[\s)"'#?>]|$)/im;
/**
 * Un bouton : une image cliquable qui parle de téléchargement ou d'installation
 * Windows. Pas « Install » seul : c'est le badge « Install in VS Code » des
 * serveurs MCP honnêtes.
 */
const BUTTON_WORDS =
  /\b(?:download|t[ée]l[ée]charger|setup|powershell)\b|(?:download|install)[-_ ]?button/i;
const MD_IMAGE_LINK = /\[!\[([^\]]*)\]\(([^)]*)\)\]\s*[[(]/g;
const HTML_IMAGE_LINK = /<a\b[^>]*>\s*(<img\b[^>]*>)/gi;

/**
 * Le README pousse-t-il à lancer un script PowerShell téléchargé ou un
 * exécutable ? Lu sur le texte brut : le nettoyage retire justement les boutons
 * (images cliquables). Cas du 20/11/2026 : un faux Ollama, bouton « PowerShell
 * setup » vers une page qui donne la commande. Pur, exporté pour tests.
 */
export function hasInstallBait(markdown: string): boolean {
  if (DOWNLOAD_AND_RUN.test(markdown) || EXECUTABLE_LINK.test(markdown)) return true;
  for (const m of markdown.matchAll(MD_IMAGE_LINK)) {
    if (BUTTON_WORDS.test(`${m[1] ?? ''} ${m[2] ?? ''}`)) return true;
  }
  for (const m of markdown.matchAll(HTML_IMAGE_LINK)) {
    if (BUTTON_WORDS.test(m[1] ?? '')) return true;
  }
  return false;
}

/**
 * Un appât d'installation ne vaut signal que chez un dépôt jeune porté par un
 * ou deux comptes ; chez un projet établi (uv, Scoop), c'est une installation
 * ordinaire. Contributeurs inconnus : comptés comme seuls. Pur, exporté pour tests.
 */
export function isBaitSuspect(
  c: Pick<RepoCandidate, 'installBait' | 'ageDays' | 'contributors'>,
): boolean {
  return c.installBait && c.ageDays <= SUSPECT_MAX_AGE_DAYS && (c.contributors ?? 0) <= 2;
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
    createdAt: r.created_at,
    ageDays,
    starsPerDay: Math.round((stars / ageDays) * 10) / 10,
    pushedAt: r.pushed_at,
    license,
    licenseKind: licenseKind(license),
    suspect: isSuspect({ stars, forks: r.forks_count, ageDays }),
    clones: [],
    installBait: false,
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
  return numbered(picked);
}

function numbered(candidates: readonly RepoCandidate[]): RepoCandidate[] {
  return candidates.map((c, i) => ({ ...c, id: `r${i + 1}` }));
}

/** Ce qu'un rapport envoyé a montré, et ce qu'il a écarté. */
export interface ShownReport {
  candidates: readonly Pick<RepoCandidate, 'repo' | 'stars' | 'clones'>[];
  releases: readonly Pick<WatchedRelease, 'repo' | 'version'>[];
  rejected: readonly Pick<VeilleRejected, 'repo' | 'cause'>[];
}

/**
 * État après un rapport envoyé : on ne remontre plus ce qui a été présenté, et
 * plus jamais un écarté (sauf `trop_jeune`, voir isFresh). Les clones d'une
 * série suivent leur représentant. Un dépôt présenté sans être écarté perd son
 * ancien écart : il a été réexaminé. Pur.
 */
export function markSeen(state: VeilleState, shown: ShownReport, date: string): VeilleState {
  const repos = { ...state.repos };
  const causes = new Map(shown.rejected.map(r => [r.repo, r.cause]));
  const mark = (repo: string, stars: number, cause: string | undefined): void => {
    repos[repo] = {
      firstSeen: repos[repo]?.firstSeen ?? date,
      lastSeen: date,
      stars,
      ...(cause === undefined ? {} : { rejected: { cause, day: date } }),
    };
  };
  for (const c of shown.candidates) {
    const cause = causes.get(c.repo);
    mark(c.repo, c.stars, cause);
    for (const clone of c.clones) mark(clone.repo, clone.stars, cause);
  }
  const known = { ...state.releases };
  for (const r of shown.releases) known[r.repo] = r.version;
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
    if (r.archived || r.fork || !isFresh(state, r.full_name, r.stargazers_count, now)) return;
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

  // Séries de clones, en deux temps : par la description avant le choix des
  // dossiers (elles prendraient la place de vrais candidats), par le README une
  // fois lus.
  const all = [...found.values()];
  const byDescription = findCloneSeries(all.map(c => seriesMember(c, null)));
  const picked = pickCandidates(collapseSeries(all, byDescription), input.perDomain);
  const texts = new Map<string, string>();
  for (const c of picked) {
    try {
      const raw = await source.readme(c.repo);
      if (raw !== null) {
        texts.set(c.repo, cleanReadme(raw));
        c.installBait = hasInstallBait(raw);
      }
      c.contributors = await source.contributors(c.repo);
      if (isBaitSuspect(c)) c.suspect = true;
    } catch {
      failed.push(`dossier:${c.repo}`);
    }
  }
  const byReadme = findCloneSeries(picked.map(c => seriesMember(c, texts.get(c.repo) ?? null)));
  const candidates = numbered(collapseSeries(picked, byReadme));

  const readmes = new Map<string, string>();
  for (const c of candidates) {
    const text = texts.get(c.repo);
    if (text === undefined) continue;
    c.readmeFile = readmeFileName(c.repo);
    c.excerpt = cutAtSentence(text, EXCERPT_MAX_CHARS);
    readmes.set(c.readmeFile, text.slice(0, README_MAX_CHARS));
  }

  return { candidates, releases, readmes, failed, queried };
}

function seriesMember(c: RepoCandidate, readme: string | null): SeriesMember {
  return { repo: c.repo, createdAt: c.createdAt, description: c.description, readme };
}
