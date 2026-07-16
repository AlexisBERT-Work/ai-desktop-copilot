import type { OllamaClient } from '../llm/OllamaClient';
import type { NewsItem } from '../tools/web/FetchTechNewsTool';
import { articleCharBudget, complete, DIGEST_LLM_OPTS } from './digestLlm';
import { ensureVerifiedDetails } from './detailVerification';
import { createLogger } from '../logger';

const log = createLogger('news:press-digest');

/** Analyse intra-journal : angle éditorial + résumé et détail par article. */
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
  const summaries = rawResumes.map(r => (typeof r === 'string' ? r.trim() : ''));
  // "details" est optionnel : les anciennes réponses (ou un modèle paresseux)
  // n'en produisent pas — la daily reste valide, juste sans « En savoir plus ».
  const rawDetails = Array.isArray(obj['details']) ? obj['details'] : [];
  const details = rawDetails.map(d => (typeof d === 'string' ? d.trim() : ''));

  if (analysis.length === 0 && summaries.length === 0) return null;
  return { analysis, summaries, details };
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
  if (items.length === 0) return { analysis: '', summaries: [], details: [] };

  // Analyse groupée (une passe pour l'angle éditorial + résumés + premiers
  // jets de détails). Son échec ne dispense PAS des détails : ils sont
  // garantis plus bas, article par article.
  let analysis = '';
  let summaries = items.map(it => (it.excerpt ? it.excerpt.slice(0, 200) : ''));
  let drafted = items.map(() => '');
  try {
    const raw = await complete(
      llm,
      model,
      SYSTEM,
      buildJournalPrompt(journal, items),
      DIGEST_LLM_OPTS,
    );
    const parsed = parseAnalysisJson(raw);
    if (parsed === null) {
      log.warn('Journal analysis JSON unparsable — falling back to excerpts', { journal });
    } else {
      analysis = parsed.analysis;
      summaries = items.map((it, i) => {
        const s = parsed.summaries[i];
        if (typeof s === 'string' && s.length > 0) return s;
        return it.excerpt ? it.excerpt.slice(0, 200) : '';
      });
      drafted = items.map((_, i) => {
        const d = parsed.details[i];
        return typeof d === 'string' ? d : '';
      });
    }
  } catch (err) {
    log.warn('Journal analysis failed — falling back to excerpts', { journal, error: String(err) });
  }

  // Garantie : un détail vérifié par article. Les jets rejetés (fait inventé)
  // ou manquants sont régénérés un par un, repli verbatim en dernier recours.
  const details = await ensureVerifiedDetails(llm, model, items, drafted);
  return { analysis, summaries, details };
}
