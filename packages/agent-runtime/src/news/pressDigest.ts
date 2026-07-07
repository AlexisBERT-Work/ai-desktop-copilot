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
- "details" : pour CHAQUE article, dans le MÊME ordre, un paragraphe de 3 à 5 phrases en français qui développe le fond : ce qui s'est passé, les acteurs, les chiffres clés et le contexte. Appuie-toi UNIQUEMENT sur le titre et le texte fournis — n'invente aucun fait. Reprends les noms propres et les nombres EXACTEMENT tels qu'ils apparaissent dans le texte. Si le texte est trop maigre pour développer, mets une chaîne vide "".
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
  opts: { numCtx?: number; timeoutMs?: number; temperature?: number } = {},
): Promise<string> {
  let text = '';
  const stream = llm.streamChat({
    model,
    system,
    messages: [{ role: 'user', content: user }],
    temperature: opts.temperature ?? 0.3,
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
  const drafted = items.map((_, i) => {
    const d = parsed.details[i];
    return typeof d === 'string' ? d : '';
  });
  // Anti-invention : un détail qui cite un nombre ou un fait absent de son
  // article est rejeté (l'UI n'affiche alors pas de « En savoir plus »).
  const details = await verifyDetails(llm, model, items, drafted);
  return { analysis: parsed.analysis, summaries, details };
}

// ─── Vérification des détails (anti-invention) ─────────────────
// Deux couches, chacune pouvant rejeter un détail (rejeté = pas de bouton
// « En savoir plus » — un détail absent vaut toujours mieux qu'un détail faux) :
// 1. déterministe : les nombres du détail doivent exister dans la source ;
// 2. LLM : un passage « vérificateur de faits » compare détail et article.

/**
 * Suites de chiffres d'un texte. On ignore la ponctuation interne (séparateurs
 * de milliers « 2,500 » / « 2 500 », décimales « 8.1 » / « 8,1 ») en découpant
 * sur tout non-chiffre : robuste aux conventions FR/EN. Pur, exporté pour tests.
 */
export function digitRuns(text: string): string[] {
  return text.match(/\d+/g) ?? [];
}

/**
 * Garde-fou déterministe : chaque suite de chiffres du détail doit apparaître
 * dans la matière source — les nombres ne se traduisent pas, un chiffre
 * inconnu est une invention. Pur, exporté pour tests.
 */
export function numbersSupported(detail: string, sourceText: string): boolean {
  const source = new Set(digitRuns(sourceText));
  return digitRuns(detail).every((n) => source.has(n));
}

/** Matière source d'un article pour la vérification (titre + meilleur texte). */
function sourceTextOf(it: NewsItem): string {
  return `${it.title}\n${it.fullText ?? it.excerpt ?? ''}`;
}

const VERIFY_SYSTEM = `Tu es un vérificateur de faits impitoyable. On te donne des articles (titre + texte) et, pour chacun, un paragraphe rédigé à partir de l'article.
Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte autour. Exemple exact pour 3 paragraphes : {"fidele":[true,false,true]}
- true si TOUT le contenu du paragraphe est directement soutenu par le titre et le texte de l'article correspondant.
- false si le paragraphe mentionne une personne, une organisation, un chiffre, un lieu ou un fait ABSENT du texte, ou s'il contredit le texte.
Le tableau "fidele" contient exactement un booléen JSON (sans guillemets) par paragraphe, dans le même ordre.`;

/** Invite de vérification pour les paires (article, détail) données. Pur, exporté pour tests. */
export function buildVerifyPrompt(pairs: { source: string; detail: string }[]): string {
  const blocks = pairs.map(
    (p, i) => `Article ${i + 1} :\n${p.source}\n\nParagraphe ${i + 1} :\n${p.detail}`,
  );
  return `Voici ${pairs.length} paires article/paragraphe :\n\n${blocks.join('\n\n---\n\n')}`;
}

/**
 * Parse les verdicts en exigeant `count` entrées. Null si illisible. Tolère ce
 * que qwen2.5:7b produit réellement : l'objet {"fidele":[...]} demandé, mais
 * aussi le tableau nu (["false","true"]) et les booléens en chaînes. Tout ce
 * qui n'est pas un true franc vaut false (prudence). Pur, exporté pour tests.
 */
export function parseVerifyJson(text: string, count: number): boolean[] | null {
  const toBool = (v: unknown): boolean =>
    v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
  const tryParse = (slice: string): unknown => {
    try {
      return JSON.parse(slice);
    } catch {
      return undefined;
    }
  };

  let arr: unknown;
  const os = text.indexOf('{');
  const oe = text.lastIndexOf('}');
  if (os !== -1 && oe > os) {
    const parsed = tryParse(text.slice(os, oe + 1));
    if (typeof parsed === 'object' && parsed !== null) {
      arr = (parsed as Record<string, unknown>)['fidele'];
    }
  }
  if (!Array.isArray(arr)) {
    const as = text.indexOf('[');
    const ae = text.lastIndexOf(']');
    if (as === -1 || ae <= as) return null;
    arr = tryParse(text.slice(as, ae + 1));
  }
  if (!Array.isArray(arr) || arr.length !== count) return null;
  return arr.map(toBool);
}

/**
 * Rejette les détails non fidèles à leur article. Couche 1 (nombres) locale et
 * sûre ; couche 2 (LLM) best-effort : si l'appel échoue ou est illisible, on
 * garde les détails restants — la couche 1 a déjà filtré le plus flagrant.
 */
export async function verifyDetails(
  llm: OllamaClient,
  model: string,
  items: NewsItem[],
  details: string[],
): Promise<string[]> {
  // Couche 1 — nombres inventés.
  const checked = details.map((d, i) => {
    const it = items[i];
    if (d.length === 0 || it === undefined) return d;
    if (numbersSupported(d, sourceTextOf(it))) return d;
    log.warn('Detail dropped — unsupported number', { title: it.title.slice(0, 60) });
    return '';
  });

  // Couche 2 — jugement LLM sur les détails restants.
  const idx = checked.map((d, i) => (d.length > 0 ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return checked;
  const budget = articleCharBudget(idx.length);
  const pairs = idx.map((i) => ({
    source: sourceTextOf(items[i]!).slice(0, budget),
    detail: checked[i]!,
  }));

  let raw: string;
  try {
    // Température 0 : on juge, on ne rédige pas.
    raw = await complete(llm, model, VERIFY_SYSTEM, buildVerifyPrompt(pairs), {
      ...DIGEST_LLM_OPTS,
      temperature: 0,
    });
  } catch (err) {
    log.warn('Detail verification failed — keeping unverified details', { error: String(err) });
    return checked;
  }
  const verdicts = parseVerifyJson(raw, pairs.length);
  if (verdicts === null) {
    log.warn('Detail verification JSON unparsable — keeping unverified details');
    return checked;
  }

  for (const [k, i] of idx.entries()) {
    if (verdicts[k] === false) {
      log.info('Detail dropped — failed fact check', { title: items[i]!.title.slice(0, 60) });
      checked[i] = '';
    }
  }
  return checked;
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
