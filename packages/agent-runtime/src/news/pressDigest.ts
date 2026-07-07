import type { DailyCategory } from '@catdesk/shared-types';
import type { OllamaClient } from '../llm/OllamaClient';
import {
  aggregateNews,
  categoryForSourceLabel,
  NEWS_SOURCES,
  type NewsItem,
} from '../tools/web/FetchTechNewsTool';
import { enrichArticleTexts } from '../tools/web/PostTechNewsDiscordTool';
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
  /** Paragraphe détaillé par article ('' si le LLM n'a rien pu développer). */
  details: string[];
}

const SYSTEM = `Tu es un analyste de presse francophone. On te donne les articles du jour publiés par UN SEUL journal.
Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :
{"analyse": "...", "resumes": ["...", "..."], "details": ["...", "..."]}
- "analyse" : 2 à 4 phrases (en français) qui dégagent les thèmes saillants et l'angle éditorial de CE journal aujourd'hui.
- "resumes" : un résumé d'UNE phrase par article, dans le MÊME ordre que la liste, en français, factuel et concis.
- "details" : pour CHAQUE article, dans le MÊME ordre, un paragraphe de 3 à 5 phrases en français qui développe le fond : ce qui s'est passé, les acteurs, les chiffres clés et le contexte. Appuie-toi UNIQUEMENT sur le titre et le texte fournis — n'invente aucun fait, aucun chiffre. Si le texte est trop maigre pour développer, mets une chaîne vide "".
Les tableaux "resumes" et "details" doivent contenir exactement autant d'éléments que d'articles.`;

/**
 * Budget de caractères de texte par article dans l'invite : vise ~12 000
 * caractères au total (≈3 500 tokens — tient dans DIGEST_NUM_CTX avec la
 * réponse), borné entre 600 et 1 500 par article. Pur, exporté pour tests.
 */
export function articleCharBudget(count: number): number {
  if (count <= 0) return 1500;
  return Math.max(600, Math.min(1500, Math.floor(12_000 / count)));
}

/**
 * Fenêtre de contexte des appels de digest : les invites incluent le corps des
 * articles (~12 k caractères) — la fenêtre par défaut d'Ollama (2-4 k tokens)
 * tronquerait silencieusement le début et le modèle déraillerait.
 */
export const DIGEST_NUM_CTX = 8192;

/**
 * Délai des appels de digest : chargement du modèle + éval de ~4 k tokens +
 * longue réponse JSON dépassent facilement les 120 s par défaut sur ce GPU —
 * c'est une tâche de fond quotidienne, on lui laisse le temps de finir.
 */
export const DIGEST_TIMEOUT_MS = 600_000;

/** Options partagées des complétions de digest (journaux, sujets, synthèse). */
export const DIGEST_LLM_OPTS = { numCtx: DIGEST_NUM_CTX, timeoutMs: DIGEST_TIMEOUT_MS } as const;

/** Construit l'invite listant les articles d'un journal. Pur, exporté pour tests. */
export function buildJournalPrompt(journal: string, items: NewsItem[]): string {
  const budget = articleCharBudget(items.length);
  const lines = items.map((it, i) => {
    const parts = [`Article ${i + 1} — ${it.title}`];
    // Corps de l'article téléchargé (enrichArticleTexts) de préférence, sinon
    // extrait RSS : c'est la seule matière autorisée pour les détails.
    const text = it.fullText && it.fullText.length > 0 ? it.fullText : it.excerpt;
    if (text && text.length > 0) parts.push(`Texte : ${text.slice(0, budget)}`);
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
  // "details" est optionnel : les anciennes réponses (ou un modèle paresseux)
  // n'en produisent pas — la daily reste valide, juste sans « En savoir plus ».
  const rawDetails = Array.isArray(obj['details']) ? obj['details'] : [];
  const details = rawDetails.map((d) => (typeof d === 'string' ? d.trim() : ''));

  if (analysis.length === 0 && summaries.length === 0) return null;
  return { analysis, summaries, details };
}

/** Titre lisible et daté d'une revue de journal. Pur. */
export function journalTitle(journal: string, now = new Date()): string {
  const date = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return `${journal} — revue du ${date}`;
}

/**
 * Corps Markdown : analyse + liste d'articles (résumé + lien). Le paragraphe
 * détaillé d'un article devient un blockquote imbriqué sous sa puce — l'UI le
 * replie derrière « En savoir plus » (NewsMarkdown), Discord le retire. Pur.
 */
export function buildJournalBody(
  analysis: string,
  items: NewsItem[],
  summaries: string[],
  details: string[] = [],
): string {
  const blocks: string[] = [];
  if (analysis.length > 0) blocks.push(analysis);

  const bullets = items
    .map((it, i) => {
      const s = typeof summaries[i] === 'string' ? summaries[i]!.trim() : '';
      const tail = s.length > 0 ? ` — ${s}` : '';
      const line = `- [${it.title}](${it.url})${tail}`;
      // Un détail multi-lignes casserait la liste : on l'aplatit. Un détail qui
      // répète le résumé n'apporte rien : on l'omet.
      const d = typeof details[i] === 'string' ? details[i]!.replace(/\s+/g, ' ').trim() : '';
      return d.length > 0 && d !== s ? `${line}\n  > ${d}` : line;
    })
    .join('\n');
  if (bullets.length > 0) blocks.push(bullets);

  return blocks.join('\n\n');
}

/** Accumule une complétion non-streamée. Partagé avec topicDigest. */
export async function complete(
  llm: OllamaClient,
  model: string,
  system: string,
  user: string,
  opts: { numCtx?: number; timeoutMs?: number } = {},
): Promise<string> {
  let text = '';
  const stream = llm.streamChat({
    model,
    system,
    messages: [{ role: 'user', content: user }],
    temperature: 0.3,
    ...(opts.numCtx !== undefined ? { numCtx: opts.numCtx } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
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
  // En repli, pas de "details" : un détail rédigé n'existe que si le LLM a pu
  // le produire — recopier l'extrait brut ferait doublon avec le résumé.
  const fallback = (): JournalAnalysis => ({
    analysis: '',
    summaries: items.map((it) => (it.excerpt ? it.excerpt.slice(0, 200) : '')),
    details: items.map(() => ''),
  });

  if (items.length === 0) return { analysis: '', summaries: [], details: [] };

  let raw: string;
  try {
    raw = await complete(llm, model, SYSTEM, buildJournalPrompt(journal, items), DIGEST_LLM_OPTS);
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
  const details = items.map((_, i) => {
    const d = parsed.details[i];
    return typeof d === 'string' ? d : '';
  });
  return { analysis: parsed.analysis, summaries, details };
}

// ─── Synthèse transversale (tous journaux) ─────────────────────

export interface JournalEntry {
  journal: string;
  analysis: string;
}

const GLOBAL_SYSTEM = `Tu es rédacteur en chef d'une revue de presse francophone. On te donne l'analyse du jour de plusieurs journaux.
Tu réponds UNIQUEMENT avec un objet JSON valide : {"idees": ["...", "..."], "synthese": "..."}
- "idees" : 3 à 5 idées fortes du jour, LA PLUS IMPORTANTE D'ABORD. Chaque idée est UNE phrase courte,
  factuelle et autoporteuse (compréhensible seule) : elle nomme les acteurs concernés et l'enjeu concret.
  Pas de généralités creuses ("l'actualité est riche") ni de méta-commentaires sur les journaux.
- "synthese" : 2 à 4 phrases qui RELIENT ces idées entre elles : la tendance de fond du jour, les points
  de friction, et les angles divergents entre journaux quand c'est pertinent. Ne répète pas les idées
  mot pour mot — apporte la lecture d'ensemble.`;

/** Invite de synthèse à partir des analyses par journal. Pur. */
export function buildGlobalPrompt(entries: JournalEntry[]): string {
  const lines = entries.map((e) => `- ${e.journal} : ${e.analysis}`);
  return `Analyses par journal :\n\n${lines.join('\n')}`;
}

export interface GlobalSynthesis {
  /** Idées fortes du jour, la plus importante d'abord. */
  ideas: string[];
  /** Lecture d'ensemble reliant les idées. */
  synthesis: string;
}

/** Extrait idées fortes + synthèse d'une réponse JSON (tolère l'ancien format sans "idees"). Pur. */
export function parseSynthesisJson(text: string): GlobalSynthesis | null {
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
  const s = obj['synthese'];
  const synthesis = typeof s === 'string' ? s.trim() : '';
  const rawIdeas = Array.isArray(obj['idees']) ? obj['idees'] : [];
  const ideas = rawIdeas
    .map((i) => (typeof i === 'string' ? i.trim() : ''))
    .filter((i) => i.length > 0);
  if (synthesis.length === 0 && ideas.length === 0) return null;
  return { ideas, synthesis };
}

/** Titre daté de la synthèse transversale. Pur. */
export function globalTitle(now = new Date()): string {
  const date = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return `Synthèse du jour — ${date}`;
}

/** Corps Markdown de la synthèse : idées fortes en tête, puis lecture d'ensemble. Pur. */
export function buildGlobalBody(synthesis: GlobalSynthesis, journals: string[]): string {
  const blocks: string[] = [];
  if (synthesis.ideas.length > 0) {
    blocks.push(`**À retenir :**\n${synthesis.ideas.map((i) => `- ${i}`).join('\n')}`);
  }
  if (synthesis.synthesis.length > 0) blocks.push(synthesis.synthesis);
  if (journals.length > 0) blocks.push(`_Journaux couverts : ${journals.join(', ')}._`);
  return blocks.join('\n\n');
}

/** Synthèse transversale via le LLM. Renvoie null en cas d'échec (non bloquant). */
export async function buildGlobalSynthesis(
  llm: OllamaClient,
  model: string,
  entries: JournalEntry[],
): Promise<GlobalSynthesis | null> {
  if (entries.length === 0) return null;
  let raw: string;
  try {
    raw = await complete(llm, model, GLOBAL_SYSTEM, buildGlobalPrompt(entries), DIGEST_LLM_OPTS);
  } catch (err) {
    log.warn('Global synthesis failed', { error: String(err) });
    return null;
  }
  return parseSynthesisJson(raw);
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

    await enrichArticleTexts(items);
    const journal = NEWS_SOURCES[id]!.label;
    const { analysis, summaries, details } = await analyzeJournal(llm, model, journal, items);

    drafts.push({
      journal,
      category: categoryForSourceLabel(journal),
      title: journalTitle(journal, now),
      body: buildJournalBody(analysis, items, summaries, details),
    });
    if (analysis.trim().length > 0) analysed.push({ journal, analysis });
  }

  // Synthèse transversale en tête (optionnelle, nécessite ≥2 analyses).
  if (deps.synthesis && analysed.length >= 2) {
    const synthesis = await buildGlobalSynthesis(llm, model, analysed);
    if (synthesis !== null) {
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
