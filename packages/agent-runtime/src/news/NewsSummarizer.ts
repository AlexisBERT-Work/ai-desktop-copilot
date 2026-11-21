import type { OllamaClient } from '../llm/OllamaClient';
import type { NewsItem } from './newsItem';
import { complete, extractJsonObject } from '../llm/completion';
import { createLogger } from '../logger';

const log = createLogger('llm:news-summary');

export interface DigestSummary {
  synthesis: string; // daily overview, 2-4 sentences
  summaries: string[]; // one per item, same order as input
}

const SYSTEM = `Tu es un journaliste tech francophone. On te donne une liste d'articles (titre, source, extrait).
Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :
{"synthese": "...", "resumes": ["...", "..."]}
- "synthese" : 2 à 4 phrases qui dégagent les grandes tendances du jour (en français).
- "resumes" : un résumé d'UNE phrase par article, dans le MÊME ordre que la liste, en français, factuel et concis.
Le tableau "resumes" doit contenir exactement autant d'éléments que d'articles.`;

/** Build the user prompt listing the articles. Pure, exported for tests. */
export function buildSummaryPrompt(items: NewsItem[]): string {
  const lines = items.map((it, i) => {
    const parts = [`Article ${i + 1} — ${it.title} (${it.source})`];
    if (it.excerpt && it.excerpt.length > 0) parts.push(`Extrait : ${it.excerpt.slice(0, 400)}`);
    return parts.join('\n');
  });
  return `Voici les ${items.length} articles du jour :\n\n${lines.join('\n\n')}`;
}

/**
 * Extract the first balanced JSON object from a model response. Tolerant of
 * markdown fences and surrounding prose. Returns null if nothing parses.
 * Pure, exported for tests.
 */
export function extractDigestJson(text: string): DigestSummary | null {
  const obj = extractJsonObject(text);
  if (obj === null) return null;
  const synthesis = typeof obj['synthese'] === 'string' ? obj['synthese'].trim() : '';
  const rawResumes = Array.isArray(obj['resumes']) ? obj['resumes'] : [];
  const summaries = rawResumes.map(r => (typeof r === 'string' ? r.trim() : ''));

  if (synthesis.length === 0 && summaries.length === 0) return null;
  return { synthesis, summaries };
}

/**
 * Produce a daily synthesis + one summary per article in a single LLM call.
 * Degrades gracefully: on any failure (Ollama down, unparsable output) it falls
 * back to the items' own excerpts so the digest is still useful.
 */
export async function summarizeDigest(
  llm: OllamaClient,
  model: string,
  items: NewsItem[],
): Promise<DigestSummary> {
  const fallback = (): DigestSummary => ({
    synthesis: '',
    summaries: items.map(it => (it.excerpt ? it.excerpt.slice(0, 280) : '')),
  });

  if (items.length === 0) return { synthesis: '', summaries: [] };

  let raw: string;
  try {
    // Sortie JSON stricte : sans think:false, le raisonnement de qwen3 la pollue.
    raw = await complete(llm, model, SYSTEM, buildSummaryPrompt(items), { think: false });
  } catch (err) {
    log.warn('News summarization failed — falling back to excerpts', { error: String(err) });
    return fallback();
  }

  const parsed = extractDigestJson(raw);
  if (!parsed) {
    log.warn('News summary JSON unparsable — falling back to excerpts');
    return fallback();
  }

  // Align summaries length with items: pad with excerpts, truncate extras.
  const summaries = items.map((it, i) => {
    const s = parsed.summaries[i];
    if (typeof s === 'string' && s.length > 0) return s;
    return it.excerpt ? it.excerpt.slice(0, 280) : '';
  });

  return { synthesis: parsed.synthesis, summaries };
}
