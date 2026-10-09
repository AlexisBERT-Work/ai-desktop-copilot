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

/**
 * Mots qui ne disent rien de l'OUTIL voulu (après normalisation, sans
 * accents) : grammaticaux, ou consignes de forme de la réponse (« réponds en
 * une seule phrase », « même format »). Ils apparaissent par hasard dans les
 * descriptions (« lecture seule », « avant de répondre », « le format est
 * déduit… »). Sans ce filtre, « quelle est la capitale de la France ? »
 * retenait describe_screen, browser_*, read_email… : ~600 tokens de prompt en
 * plus, et un début de prompt qui changeait à chaque question — donc relu en
 * entier par Ollama au lieu d'être servi par son cache.
 */
const STOPWORDS = new Set(
  [
    'les des une est sont pour par sur dans avec sans que qui quoi quel quelle quels',
    'quelles cet cette ces mon mes ton tes son ses notre votre leur leurs moi toi lui',
    'elle nous vous ils elles aux pas plus moins tout tous toute toutes comme mais',
    'donc car peux peut veux etre avoir fait faire dit aussi tres bien celle celui',
    'ceux meme quand ou the and for with from this that what which are was its into',
    'your you',
    // Consignes de forme de la réponse.
    'reponds repond reponse repondre seul seule phrase phrases court courte bref',
    'breve format formats',
  ]
    .join(' ')
    .split(' '),
);

/** Light stem so "dailies"/"daily", "tâches"/"tache", "planifiées"/"planifie" overlap. */
function tokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter(w => w.length >= 3 && !STOPWORDS.has(w))
    .map(w => w.replace(/(s|es|ees|er|ent)$/u, ''));
}

/**
 * Le noyau, dans l'ordre d'enregistrement : c'est le DÉBUT de la liste d'outils
 * de chaque requête (voir `selectTools`), donc ce que le préchauffage lit
 * d'avance pour qu'Ollama l'ait déjà en cache à la première question.
 */
export function coreTools<T extends SelectableTool>(tools: T[], limit = 14): T[] {
  if (limit <= 0 || tools.length <= limit) return tools;
  return tools.filter(t => ESSENTIAL_CORE.includes(t.name));
}

/**
 * Ordre du résultat (latence) : le noyau d'abord, puis les outils retenus pour
 * la requête, TOUS dans l'ordre d'enregistrement — pas par score. Ollama ne
 * relit le prompt qu'à partir du premier écart : deux requêtes qui retiennent
 * les mêmes outils produisent ainsi exactement le même prompt.
 */
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

  // 1. Essential core first.
  const core = coreTools(tools, limit);
  const picked = new Set(core.map(t => t.name));
  // 2. Query-relevant tools, highest score first, within the remaining budget.
  const ranked = tools
    .filter(t => !picked.has(t.name))
    .map(t => ({ t, s: score(t) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s);

  for (const { t } of ranked) {
    if (picked.size >= limit) break;
    picked.add(t.name);
  }

  // 3. Emitted in registration order (see the doc above), core first.
  const extras = tools.filter(t => picked.has(t.name) && !core.includes(t));
  return [...core, ...extras];
}
