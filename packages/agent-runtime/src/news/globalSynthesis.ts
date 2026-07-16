import type { OllamaClient } from '../llm/OllamaClient';
import { complete, DIGEST_LLM_OPTS } from './digestLlm';
import { createLogger } from '../logger';

const log = createLogger('news:press-digest');

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
  const lines = entries.map(e => `- ${e.journal} : ${e.analysis}`);
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
    .map(i => (typeof i === 'string' ? i.trim() : ''))
    .filter(i => i.length > 0);
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
    blocks.push(`**À retenir :**\n${synthesis.ideas.map(i => `- ${i}`).join('\n')}`);
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
