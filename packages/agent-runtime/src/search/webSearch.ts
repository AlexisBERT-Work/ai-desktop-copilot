/**
 * Recherche web sans clé ni compte (veille du 13/11) : quatre API publiques,
 * gratuites, interrogées en parallèle, et une sortie COURTE.
 *
 * - Wikipédia (français, repli anglais) : définitions, personnes, lieux ;
 * - Hacker News (Algolia) : ce qu'en disent les développeurs, avec les votes ;
 * - GitHub (recherche de dépôts, sans jeton : 10 requêtes par minute) ;
 * - Stack Overflow (API Stack Exchange, sans clé : 300 requêtes par jour).
 *
 * Écartés : Reddit (403 sans OAuth depuis 2023, vérifié le 2026-11-21), et
 * tout moteur généraliste (Google, Bing, Brave : clé, souvent payante ;
 * DuckDuckGo : pas d'API de résultats, seulement du HTML à racler).
 *
 * Latence : tout ce que renvoie un outil est relu par le modèle (~12 ms le
 * token sur la machine cible). D'où 10 résultats au plus, des extraits de 160
 * caractères et un plafond de 4 500 caractères (~1 500 tokens) pour le tout.
 *
 * La requête part chez des tiers : les données personnelles qu'elle contient
 * (carte, IBAN, n° de sécu, e-mail, téléphone) sont masquées avant l'envoi.
 */
import { API_USER_AGENT, httpRequest } from '../lib/http';
import { htmlToText } from '../lib/readableText';
import { scanPersonalData } from '../security/personalData';

export const WEB_SOURCES = ['wikipedia', 'hackernews', 'github', 'stackoverflow'] as const;
export type WebSource = (typeof WEB_SOURCES)[number];

export interface WebHit {
  source: WebSource;
  titre: string;
  url: string;
  /** Publication (HN, Stack Overflow) ou dernier commit (GitHub), AAAA-MM-JJ. */
  date?: string;
  /** Votes, étoiles, réponses : ce qui dit si le résultat compte. */
  info?: string;
  extrait?: string;
}

export interface WebSearchResult {
  requete: string;
  resultats: WebHit[];
  /** Sources en échec (réseau, quota), avec la raison. */
  echecs?: string[];
  /** La requête contenait une donnée personnelle, masquée avant l'envoi. */
  requete_masquee?: true;
  /** Des résultats ont été retirés pour tenir dans le plafond. */
  coupe?: true;
}

/** GET d'une URL d'API qui renvoie du JSON ; lève sur un statut d'erreur. */
export type JsonFetcher = (url: string) => Promise<unknown>;

export interface WebSearchOptions {
  /** Seulement les N derniers jours (Hacker News, GitHub, Stack Overflow). */
  days?: number;
  fetchJson?: JsonFetcher;
  now?: Date;
}

export const MAX_RESULTS = 10;
export const MAX_RESULT_CHARS = 4_500;
const EXCERPT_CHARS = 160;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1_500_000;

/** Résultats par source : répartis quand on interroge les quatre. */
const PER_SOURCE_ALL: Record<WebSource, number> = {
  wikipedia: 3,
  hackernews: 3,
  github: 2,
  stackoverflow: 2,
};
const PER_SOURCE_ALONE = 8;

const defaultFetchJson: JsonFetcher = async url => {
  const res = await httpRequest(url, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxBytes: MAX_RESPONSE_BYTES,
    headers: { 'User-Agent': API_USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.text) as unknown;
};

// ─── Lecture prudente du JSON des API ─────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Texte d'API (HTML ou entités) en une ligne, coupé à `max` caractères. */
export function cleanSnippet(raw: string, max = EXCERPT_CHARS): string {
  const text = htmlToText(raw).replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

function sinceSeconds(now: Date, days: number): number {
  return Math.floor(now.getTime() / 1000) - days * 86_400;
}

/** Ajoute les champs définis seulement (`exactOptionalPropertyTypes`). */
function withOptional(
  base: WebHit,
  extra: Partial<Record<'date' | 'info' | 'extrait', string | undefined>>,
): WebHit {
  const out: WebHit = { ...base };
  if (extra.date !== undefined) out.date = extra.date;
  if (extra.info !== undefined) out.info = extra.info;
  if (extra.extrait !== undefined) out.extrait = extra.extrait;
  return out;
}

const fr = (n: number): string => n.toLocaleString('fr-FR');

/** « 1 point », « 0 point », « 2 points » (règle française : pluriel à partir de 2). */
const count = (n: number, word: string): string => `${fr(n)} ${word}${Math.abs(n) >= 2 ? 's' : ''}`;

// ─── Les quatre sources ───────────────────────────────────────

async function searchWikipedia(
  query: string,
  limit: number,
  fetchJson: JsonFetcher,
): Promise<WebHit[]> {
  for (const lang of ['fr', 'en']) {
    const url =
      `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1` +
      `&srprop=snippet&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`;
    const data = await fetchJson(url);
    const search = isRecord(data) && isRecord(data['query']) ? data['query']['search'] : [];
    const hits = records(search).flatMap(r => {
      const title = str(r['title']);
      if (title === undefined) return [];
      const page = encodeURIComponent(title.replace(/ /g, '_'));
      const snippet = str(r['snippet']);
      return [
        withOptional(
          { source: 'wikipedia', titre: title, url: `https://${lang}.wikipedia.org/wiki/${page}` },
          { extrait: snippet === undefined ? undefined : cleanSnippet(snippet) },
        ),
      ];
    });
    if (hits.length > 0) return hits;
  }
  return [];
}

async function searchHackerNews(
  query: string,
  limit: number,
  fetchJson: JsonFetcher,
  now: Date,
  days: number | undefined,
): Promise<WebHit[]> {
  const filter =
    days === undefined ? '' : `&numericFilters=created_at_i>${sinceSeconds(now, days)}`;
  const data = await fetchJson(
    `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=${limit}` +
      `&query=${encodeURIComponent(query)}${filter}`,
  );
  return records(isRecord(data) ? data['hits'] : []).flatMap(h => {
    const title = str(h['title']);
    const id = str(h['objectID']);
    if (title === undefined || id === undefined) return [];
    const points = num(h['points']) ?? 0;
    const comments = num(h['num_comments']) ?? 0;
    const created = str(h['created_at']);
    const link = str(h['url']);
    return [
      withOptional(
        {
          source: 'hackernews',
          titre: cleanSnippet(title, 200),
          // La discussion, pas l'article : c'est elle qui dit ce qu'en pensent les gens.
          url: `https://news.ycombinator.com/item?id=${id}`,
          info: `${count(points, 'point')}, ${count(comments, 'commentaire')}`,
        },
        {
          date: created?.slice(0, 10),
          extrait: link === undefined ? undefined : `article : ${cleanSnippet(link, 120)}`,
        },
      ),
    ];
  });
}

async function searchGitHub(
  query: string,
  limit: number,
  fetchJson: JsonFetcher,
  now: Date,
  days: number | undefined,
): Promise<WebHit[]> {
  const pushed =
    days === undefined ? '' : ` pushed:>${isoDay(new Date(sinceSeconds(now, days) * 1000))}`;
  const data = await fetchJson(
    // Tri par pertinence (défaut de GitHub) : par étoiles, « Tauri 2 » sortait une
    // appli populaire écrite avec Tauri avant Tauri lui-même (essai du 2026-11-21).
    `https://api.github.com/search/repositories?per_page=${limit}` +
      `&q=${encodeURIComponent(query + pushed)}`,
  );
  return records(isRecord(data) ? data['items'] : []).flatMap(r => {
    const name = str(r['full_name']);
    const url = str(r['html_url']);
    if (name === undefined || url === undefined) return [];
    const stars = num(r['stargazers_count']) ?? 0;
    const language = str(r['language']);
    const description = str(r['description']);
    return [
      withOptional(
        {
          source: 'github',
          titre: name,
          url,
          info: `${count(stars, 'étoile')}${language === undefined ? '' : `, ${language}`}`,
        },
        {
          date: str(r['pushed_at'])?.slice(0, 10),
          extrait: description === undefined ? undefined : cleanSnippet(description),
        },
      ),
    ];
  });
}

async function searchStackOverflow(
  query: string,
  limit: number,
  fetchJson: JsonFetcher,
  now: Date,
  days: number | undefined,
): Promise<WebHit[]> {
  const from = days === undefined ? '' : `&fromdate=${sinceSeconds(now, days)}`;
  const data = await fetchJson(
    `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&site=stackoverflow` +
      `&pagesize=${limit}&q=${encodeURIComponent(query)}${from}`,
  );
  return records(isRecord(data) ? data['items'] : []).flatMap(q => {
    const title = str(q['title']);
    const url = str(q['link']);
    if (title === undefined || url === undefined) return [];
    const score = num(q['score']) ?? 0;
    const answers = num(q['answer_count']) ?? 0;
    const created = num(q['creation_date']);
    const solved = q['is_answered'] === true ? ', résolue' : '';
    return [
      withOptional(
        {
          source: 'stackoverflow',
          titre: cleanSnippet(title, 200),
          url,
          info: `score ${fr(score)}, ${count(answers, 'réponse')}${solved}`,
        },
        { date: created === undefined ? undefined : isoDay(new Date(created * 1000)) },
      ),
    ];
  });
}

// ─── Assemblage ───────────────────────────────────────────────

/**
 * Garde l'ordre des sources, retire des résultats par la fin jusqu'à tenir
 * dans `maxChars` une fois sérialisé. Pur, exporté pour les tests.
 */
export function capResults(
  result: WebSearchResult,
  maxItems = MAX_RESULTS,
  maxChars = MAX_RESULT_CHARS,
): WebSearchResult {
  let resultats = result.resultats.slice(0, maxItems);
  let cut = resultats.length < result.resultats.length;
  const build = (): WebSearchResult => ({
    ...result,
    resultats,
    ...(cut ? { coupe: true as const } : {}),
  });
  while (resultats.length > 1 && JSON.stringify(build()).length > maxChars) {
    resultats = resultats.slice(0, -1);
    cut = true;
  }
  return build();
}

/**
 * Interroge les sources demandées en parallèle. Ne lève pas : une source en
 * échec est listée dans `echecs` ; c'est à l'appelant de juger un résultat
 * vide.
 */
export async function searchWeb(
  rawQuery: string,
  sources: readonly WebSource[] = WEB_SOURCES,
  opts: WebSearchOptions = {},
): Promise<WebSearchResult> {
  const scan = scanPersonalData(rawQuery.trim(), { maskContacts: true });
  const query = scan.text;
  const fetchJson = opts.fetchJson ?? defaultFetchJson;
  const now = opts.now ?? new Date();
  const alone = sources.length === 1;
  const limitFor = (s: WebSource): number => (alone ? PER_SOURCE_ALONE : PER_SOURCE_ALL[s]);

  const run = (s: WebSource): Promise<WebHit[]> => {
    switch (s) {
      case 'wikipedia':
        return searchWikipedia(query, limitFor(s), fetchJson);
      case 'hackernews':
        return searchHackerNews(query, limitFor(s), fetchJson, now, opts.days);
      case 'github':
        return searchGitHub(query, limitFor(s), fetchJson, now, opts.days);
      case 'stackoverflow':
        return searchStackOverflow(query, limitFor(s), fetchJson, now, opts.days);
    }
  };

  const settled = await Promise.allSettled(sources.map(run));
  const resultats: WebHit[] = [];
  const echecs: string[] = [];
  settled.forEach((outcome, i) => {
    const source = sources[i] ?? 'wikipedia';
    if (outcome.status === 'fulfilled') {
      resultats.push(...outcome.value.slice(0, limitFor(source)));
    } else {
      const reason = outcome.reason instanceof Error ? outcome.reason.message : 'échec';
      echecs.push(`${source} : ${cleanSnippet(reason, 80)}`);
    }
  });

  return capResults({
    requete: query,
    resultats,
    ...(echecs.length > 0 ? { echecs } : {}),
    ...(scan.findings.length > 0 ? { requete_masquee: true as const } : {}),
  });
}
