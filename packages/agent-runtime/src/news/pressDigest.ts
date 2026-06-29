import type { DailyCategory } from '@catdesk/shared-types';
import type { OllamaClient } from '../llm/OllamaClient';
import {
  aggregateNews,
  categoryForSourceLabel,
  NEWS_SOURCES,
  type NewsItem,
} from '../tools/web/FetchTechNewsTool';
import { enrichExcerpts } from '../tools/web/PostTechNewsDiscordTool';
import { createLogger } from '../logger';

const log = createLogger('news:press-digest');

/** Une daily prête à publier : l'analyse du jour d'UN journal. */
export interface JournalDraft {
  journal: string;
  category: DailyCategory;
  title: string;
  body: string; // Markdown
}

export interface JournalAnalysis {
  analysis: string;
  summaries: string[];
}

const SYSTEM = `Tu es un analyste de presse francophone. On te donne les articles du jour publiés par UN SEUL journal.
Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :
{"analyse": "...", "resumes": ["...", "..."]}
- "analyse" : 2 à 4 phrases (en français) qui dégagent les thèmes saillants et l'angle éditorial de CE journal aujourd'hui.
- "resumes" : un résumé d'UNE phrase par article, dans le MÊME ordre que la liste, en français, factuel et concis.
Le tableau "resumes" doit contenir exactement autant d'éléments que d'articles.`;

/** Construit l'invite listant les articles d'un journal. Pur, exporté pour tests. */
export function buildJournalPrompt(journal: string, items: NewsItem[]): string {
  const lines = items.map((it, i) => {
    const parts = [`Article ${i + 1} — ${it.title}`];
    if (it.excerpt && it.excerpt.length > 0) parts.push(`Extrait : ${it.excerpt.slice(0, 400)}`);
    return parts.join('\n');
  });
  return `Journal : ${journal}\nVoici les ${items.length} articles du jour :\n\n${lines.join('\n\n')}`;
}

/**
 * Extrait le premier objet JSON équilibré d'une réponse modèle (tolérant aux
 * fences markdown et au texte autour). Renvoie null si rien ne parse. Pur.
 */
export function parseAnalysisJson(text: string): JournalAnalysis | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const analysis = typeof obj['analyse'] === 'string' ? obj['analyse'].trim() : '';
  const rawResumes = Array.isArray(obj['resumes']) ? obj['resumes'] : [];
  const summaries = rawResumes.map((r) => (typeof r === 'string' ? r.trim() : ''));

  if (analysis.length === 0 && summaries.length === 0) return null;
  return { analysis, summaries };
}

/** Titre lisible et daté d'une revue de journal. Pur. */
export function journalTitle(journal: string, now = new Date()): string {
  const date = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return `${journal} — revue du ${date}`;
}

/** Corps Markdown : analyse + liste d'articles (résumé + lien). Pur. */
export function buildJournalBody(analysis: string, items: NewsItem[], summaries: string[]): string {
  const blocks: string[] = [];
  if (analysis.length > 0) blocks.push(analysis);

  const bullets = items
    .map((it, i) => {
      const s = typeof summaries[i] === 'string' ? summaries[i]!.trim() : '';
      const tail = s.length > 0 ? ` — ${s}` : '';
      return `- [${it.title}](${it.url})${tail}`;
    })
    .join('\n');
  if (bullets.length > 0) blocks.push(bullets);

  return blocks.join('\n\n');
}

/** Accumule une complétion non-streamée. */
async function complete(llm: OllamaClient, model: string, system: string, user: string): Promise<string> {
  let text = '';
  const stream = llm.streamChat({
    model,
    system,
    messages: [{ role: 'user', content: user }],
    temperature: 0.3,
  });
  for await (const chunk of stream) {
    if (chunk.type === 'token') text += chunk.content;
    else if (chunk.type === 'error') throw new Error(chunk.error);
  }
  return text;
}

/**
 * Analyse intra-journal via le LLM local. Dégrade proprement : en cas d'échec
 * (Ollama indisponible, sortie illisible) on retombe sur les extraits.
 */
export async function analyzeJournal(
  llm: OllamaClient,
  model: string,
  journal: string,
  items: NewsItem[],
): Promise<JournalAnalysis> {
  const fallback = (): JournalAnalysis => ({
    analysis: '',
    summaries: items.map((it) => (it.excerpt ? it.excerpt.slice(0, 200) : '')),
  });

  if (items.length === 0) return { analysis: '', summaries: [] };

  let raw: string;
  try {
    raw = await complete(llm, model, SYSTEM, buildJournalPrompt(journal, items));
  } catch (err) {
    log.warn('Journal analysis failed — falling back to excerpts', { journal, error: String(err) });
    return fallback();
  }

  const parsed = parseAnalysisJson(raw);
  if (parsed === null) {
    log.warn('Journal analysis JSON unparsable — falling back to excerpts', { journal });
    return fallback();
  }

  const summaries = items.map((it, i) => {
    const s = parsed.summaries[i];
    if (typeof s === 'string' && s.length > 0) return s;
    return it.excerpt ? it.excerpt.slice(0, 200) : '';
  });
  return { analysis: parsed.analysis, summaries };
}

// ─── Synthèse transversale (tous journaux) ─────────────────────

export interface JournalEntry {
  journal: string;
  analysis: string;
}

const GLOBAL_SYSTEM = `Tu es rédacteur en chef d'une revue de presse francophone. On te donne l'analyse du jour de plusieurs journaux.
Tu réponds UNIQUEMENT avec un objet JSON valide : {"synthese": "..."}
- "synthese" : 3 à 5 phrases (en français) dégageant les grandes tendances TRANSVERSALES du jour et, quand c'est pertinent, les angles différents selon les journaux.`;

/** Invite de synthèse à partir des analyses par journal. Pur. */
export function buildGlobalPrompt(entries: JournalEntry[]): string {
  const lines = entries.map((e) => `- ${e.journal} : ${e.analysis}`);
  return `Analyses par journal :\n\n${lines.join('\n')}`;
}

/** Extrait la "synthese" d'une réponse JSON. Pur. */
export function parseSynthesisJson(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const s = (parsed as Record<string, unknown>)['synthese'];
  const synthesis = typeof s === 'string' ? s.trim() : '';
  return synthesis.length > 0 ? synthesis : null;
}

/** Titre daté de la synthèse transversale. Pur. */
export function globalTitle(now = new Date()): string {
  const date = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return `Synthèse du jour — ${date}`;
}

/** Corps Markdown de la synthèse (texte + journaux couverts). Pur. */
export function buildGlobalBody(synthesis: string, journals: string[]): string {
  const blocks = [synthesis];
  if (journals.length > 0) blocks.push(`_Journaux couverts : ${journals.join(', ')}._`);
  return blocks.join('\n\n');
}

/** Synthèse transversale via le LLM. Renvoie '' en cas d'échec (non bloquant). */
export async function buildGlobalSynthesis(
  llm: OllamaClient,
  model: string,
  entries: JournalEntry[],
): Promise<string> {
  if (entries.length === 0) return '';
  let raw: string;
  try {
    raw = await complete(llm, model, GLOBAL_SYSTEM, buildGlobalPrompt(entries));
  } catch (err) {
    log.warn('Global synthesis failed', { error: String(err) });
    return '';
  }
  return parseSynthesisJson(raw) ?? '';
}

export interface PressDigestDeps {
  llm: OllamaClient;
  model: string;
  /** Ids de sources (clés de NEWS_SOURCES). */
  sourceIds: string[];
  /** Mots-clés de filtrage (« recherche de caractères ») dans titre + extrait. */
  topics: string[];
  sinceHours: number;
  /** Articles max par journal. */
  perJournalLimit: number;
  /** Ajoute une daily « Synthèse du jour » transversale en tête. */
  synthesis: boolean;
  now?: Date;
}

/**
 * Construit une daily par journal : agrège les articles du jour de chaque source,
 * applique le filtre par mots-clés, puis demande au LLM une analyse intra-journal
 * + un résumé par article. Une source sans article (ou en échec) est ignorée.
 */
export async function buildPressDailies(deps: PressDigestDeps): Promise<JournalDraft[]> {
  const { llm, model, sourceIds, topics, sinceHours, perJournalLimit } = deps;
  const now = deps.now ?? new Date();
  const ids = sourceIds.filter((id) => id in NEWS_SOURCES);
  const drafts: JournalDraft[] = [];
  const analysed: JournalEntry[] = [];

  for (const id of ids) {
    let items: NewsItem[] = [];
    try {
      const res = await aggregateNews({ sources: [id], topics, sinceHours, limit: perJournalLimit });
      items = res.items;
    } catch (err) {
      log.warn('Source fetch failed — skipped', { id, error: String(err) });
      continue;
    }
    if (items.length === 0) continue;

    await enrichExcerpts(items);
    const journal = NEWS_SOURCES[id]!.label;
    const { analysis, summaries } = await analyzeJournal(llm, model, journal, items);

    drafts.push({
      journal,
      category: categoryForSourceLabel(journal),
      title: journalTitle(journal, now),
      body: buildJournalBody(analysis, items, summaries),
    });
    if (analysis.trim().length > 0) analysed.push({ journal, analysis });
  }

  // Synthèse transversale en tête (optionnelle, nécessite ≥2 analyses).
  if (deps.synthesis && analysed.length >= 2) {
    const synthesis = await buildGlobalSynthesis(llm, model, analysed);
    if (synthesis.length > 0) {
      drafts.unshift({
        journal: 'Synthèse',
        category: 'misc',
        title: globalTitle(now),
        body: buildGlobalBody(synthesis, analysed.map((a) => a.journal)),
      });
    }
  }

  log.info('Press dailies built', { journals: drafts.length, requested: ids.length, synthesis: deps.synthesis });
  return drafts;
}
