/**
 * Tool pre-selection.
 *
 * Exposing all ~50 tools to the model on every call balloons the prompt to
 * several thousand tokens (each tool's name + description + JSON schema), which
 * dominates latency on local models (prompt eval is O(prompt size)) and hurts
 * tool-choice accuracy. We instead send a small, query-relevant subset:
 *   - a fixed essential core (always available for basic ops),
 *   - plus tools whose name/description/category match the user's query,
 * capped at `limit`. Set limit to 0 (or tools.length ≤ limit) to send them all.
 */

export interface SelectableTool {
  name: string;
  description: string;
  category: string;
}

/**
 * Always kept so core capabilities never disappear behind the relevance filter.
 * Orienté recherche/articles (mission première du bot) : les outils fichiers/
 * shell restent disponibles mais ne remontent que si la requête les évoque.
 */
const ESSENTIAL_CORE = [
  'search_dailies',
  'read_webpage',
  'fetch_tech_news',
  'search_memory',
  'read_clipboard',
  'list_scheduled_tasks',
  'schedule_task',
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, ' ');
}

/** Light stem so "dailies"/"daily", "tâches"/"tache", "planifiées"/"planifie" overlap. */
function tokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter(w => w.length >= 3)
    .map(w => w.replace(/(s|es|ees|er|ent)$/u, ''));
}

export function selectTools<T extends SelectableTool>(tools: T[], query: string, limit = 14): T[] {
  if (limit <= 0 || tools.length <= limit) return tools;

  const qWords = new Set(tokens(query));
  // A couple of intent synonyms that rarely appear verbatim in tool text.
  if (/\bdail(y|ies)\b|quotidien|chaque jour/i.test(query)) {
    qWords.add('planifi');
    qWords.add('schedul');
    qWords.add('recurrent');
  }

  const score = (t: T): number => {
    const hayTokens = new Set(tokens(`${t.name} ${t.description} ${t.category}`));
    let s = 0;
    for (const w of qWords) {
      for (const h of hayTokens) {
        if (h === w || h.startsWith(w) || w.startsWith(h)) {
          s++;
          break;
        }
      }
    }
    return s;
  };

  const picked = new Map<string, T>();
  // 1. Essential core first.
  for (const t of tools) {
    if (ESSENTIAL_CORE.includes(t.name)) picked.set(t.name, t);
  }
  // 2. Query-relevant tools, highest score first.
  const ranked = tools
    .filter(t => !picked.has(t.name))
    .map(t => ({ t, s: score(t) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s);

  for (const { t } of ranked) {
    if (picked.size >= limit) break;
    picked.set(t.name, t);
  }

  return [...picked.values()];
}
