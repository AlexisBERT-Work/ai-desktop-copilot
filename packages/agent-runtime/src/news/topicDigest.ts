import type { DailyCategory } from '@catdesk/shared-types';
import type { OllamaClient } from '../llm/OllamaClient';
import { aggregateNews, type NewsItem } from '../tools/web/FetchTechNewsTool';
import { enrichExcerpts } from '../tools/web/PostTechNewsDiscordTool';
import { complete, type JournalDraft } from './pressDigest';
import { createLogger } from '../logger';

const log = createLogger('news:topic-digest');

/** Sujets fixes du digest transversal + catégorie de daily associée. */
export const NEWS_TOPICS = [
  { name: 'International', category: 'misc' },
  { name: 'Économie & marchés', category: 'markets' },
  { name: 'Politique', category: 'macro' },
  { name: 'Société', category: 'misc' },
  { name: 'Tech & sciences', category: 'tech' },
  { name: 'Culture & sport', category: 'misc' },
] as const satisfies readonly { name: string; category: DailyCategory }[];

const TOPIC_CATEGORY = new Map<string, DailyCategory>(NEWS_TOPICS.map((t) => [t.name, t.category]));

export function categoryForTopic(name: string): DailyCategory {
  return TOPIC_CATEGORY.get(name) ?? 'misc';
}

const SYSTEM = `Tu es rédacteur en chef d'une revue de presse francophone. On te donne les articles les plus importants du jour, toutes sources confondues.
Range chaque article sous le SUJET le plus pertinent (parmi la liste autorisée), et pour chaque sujet ayant au moins un article, rédige un résumé synthétique des développements clés.
Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :
{"sujets":[{"sujet":"<nom exact de la liste>","resume":"2 à 4 phrases en français","articles":[<index>, ...]}]}
- N'invente aucun sujet hors de la liste autorisée.
- Mets chaque article dans AU PLUS un sujet (le plus pertinent) ; ignore ceux qui ne rentrent nulle part.
- "articles" liste les index (nombres) des articles concernés.`;

/** Invite listant les articles à classer. Pur, exporté pour tests. */
export function buildTopicPrompt(items: NewsItem[], topics: readonly string[]): string {
  const lines = items.map((it, i) => {
    const head = `[${i}] ${it.title} (${it.source})`;
    return it.excerpt && it.excerpt.length > 0 ? `${head}\n    ${it.excerpt.slice(0, 300)}` : head;
  });
  return `Sujets autorisés : ${topics.join(', ')}.\n\nArticles du jour :\n\n${lines.join('\n')}`;
}

export interface TopicGroup {
  topic: string;
  summary: string;
  indices: number[];
}

/** Parse la réponse JSON de regroupement par sujet. Pur, tolérant. */
export function parseTopicJson(text: string, allowed: readonly string[]): TopicGroup[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const arr = (parsed as Record<string, unknown>)['sujets'];
  if (!Array.isArray(arr)) return [];

  const allow = new Set(allowed);
  const out: TopicGroup[] = [];
  for (const g of arr) {
    if (g === null || typeof g !== 'object') continue;
    const o = g as Record<string, unknown>;
    const topic = typeof o['sujet'] === 'string' ? o['sujet'].trim() : '';
    if (!allow.has(topic)) continue;
    const summary = typeof o['resume'] === 'string' ? o['resume'].trim() : '';
    const indices = Array.isArray(o['articles'])
      ? o['articles'].filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0)
      : [];
    if (summary.length === 0 && indices.length === 0) continue;
    out.push({ topic, summary, indices });
  }
  return out;
}

/** Titre daté d'un sujet. Pur. */
export function topicTitle(topic: string, now = new Date()): string {
  const date = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return `Sujet — ${topic} · ${date}`;
}

/** Corps Markdown : résumé + articles (lien + source). Pur. */
export function buildTopicBody(summary: string, items: NewsItem[]): string {
  const blocks: string[] = [];
  if (summary.length > 0) blocks.push(summary);
  const bullets = items.map((it) => `- [${it.title}](${it.url}) _(${it.source})_`).join('\n');
  if (bullets.length > 0) blocks.push(bullets);
  return blocks.join('\n\n');
}

export interface TopicDigestDeps {
  llm: OllamaClient;
  model: string;
  /** Ids de sources (clés de NEWS_SOURCES) à agréger ensemble. */
  sourceIds: string[];
  /** Mots-clés de filtrage (« recherche de caractères »). */
  topics: string[];
  sinceHours: number;
  /** Nombre d'articles (les plus importants) soumis au regroupement. */
  limit: number;
  now?: Date;
}

/**
 * Digest transversal : agrège les articles les plus importants de toutes les
 * sources, les fait regrouper PAR SUJET par le LLM, et produit une daily par
 * sujet (résumé + liens). Dégrade proprement (renvoie [] en cas d'échec).
 */
export async function buildTopicDigest(deps: TopicDigestDeps): Promise<JournalDraft[]> {
  const { llm, model, sourceIds, topics, sinceHours, limit } = deps;
  const now = deps.now ?? new Date();

  let items: NewsItem[] = [];
  try {
    const res = await aggregateNews({ sources: sourceIds, topics, sinceHours, limit });
    items = res.items;
  } catch (err) {
    log.warn('Topic digest fetch failed', { error: String(err) });
    return [];
  }
  if (items.length === 0) return [];

  await enrichExcerpts(items);
  const names = NEWS_TOPICS.map((t) => t.name);

  let raw: string;
  try {
    raw = await complete(llm, model, SYSTEM, buildTopicPrompt(items, names));
  } catch (err) {
    log.warn('Topic digest LLM failed', { error: String(err) });
    return [];
  }

  const groups = parseTopicJson(raw, names);
  const drafts: JournalDraft[] = [];
  for (const g of groups) {
    const picked = g.indices
      .map((i) => items[i])
      .filter((x): x is NewsItem => x !== undefined);
    if (picked.length === 0 && g.summary.length === 0) continue;
    drafts.push({
      journal: g.topic,
      category: categoryForTopic(g.topic),
      title: topicTitle(g.topic, now),
      body: buildTopicBody(g.summary, picked),
    });
  }

  log.info('Topic digest built', { topics: drafts.length, articles: items.length });
  return drafts;
}
