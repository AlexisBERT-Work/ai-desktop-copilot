import { cutToTokens, textTokens } from './contextBudget';

/**
 * Réduit une sortie d'outil à un budget de tokens AVANT de l'envoyer au
 * modèle. Sans ça, Ollama la coupe lui-même, sans erreur (voir
 * `contextBudget.ts`), et le modèle répond sur ce qui reste comme si c'était
 * tout. On garde la structure et le début de chaque texte, plutôt que de
 * trancher le JSON à l'aveugle :
 *
 * 1. les listes trop longues perdent leur seconde moitié, la plus coûteuse
 *    d'abord, tant que réduire les textes au minimum ne suffirait pas ;
 * 2. puis tous les textes sont plafonnés au même nombre de tokens, le plus
 *    haut qui tienne : les courts restent entiers, les longs perdent leur fin.
 *
 * Chaque coupe est marquée, pour que le modèle sache ce qui manque.
 */

export interface FittedOutput {
  /** Données telles que le modèle les verra (JSON pur : dates en chaînes). */
  data: unknown;
  cut: boolean;
  tokens: number;
  originalTokens: number;
}

/** Un texte n'est jamais ramené sous ce nombre de tokens (titres, extraits). */
const MIN_STRING_TOKENS = 40;
/** Coût d'un marqueur de coupe, dans un texte ou en fin de liste. */
const MARK_TOKENS = 12;

const tokensOf = (value: unknown): number => textTokens(JSON.stringify(value) ?? 'null');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function capStrings(value: unknown, cap: number): unknown {
  if (typeof value === 'string') {
    if (textTokens(value) <= cap + MARK_TOKENS) return value;
    const kept = cutToTokens(value, cap);
    return `${kept} … [coupé : ${kept.length} caractères sur ${value.length}]`;
  }
  if (Array.isArray(value)) return value.map(v => capStrings(v, cap));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = capStrings(v, cap);
    return out;
  }
  return value;
}

function maxStringTokens(value: unknown): number {
  if (typeof value === 'string') return textTokens(value);
  const children = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
  let max = 0;
  for (const child of children) max = Math.max(max, maxStringTokens(child));
  return max;
}

/** La liste qui coûte le plus parmi celles qui ont encore deux éléments. */
function costliestArray(root: unknown): unknown[] | undefined {
  let best: unknown[] | undefined;
  let bestCost = -1;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      if (value.length >= 2) {
        const cost = tokensOf(value);
        if (cost > bestCost) {
          best = value;
          bestCost = cost;
        }
      }
      value.forEach(visit);
    } else if (isRecord(value)) {
      Object.values(value).forEach(visit);
    }
  };
  visit(root);
  return best;
}

export function fitToBudget(data: unknown, maxTokens: number): FittedOutput {
  const originalTokens = tokensOf(data);
  if (originalTokens <= maxTokens)
    return { data, cut: false, tokens: originalTokens, originalTokens };

  // Copie en JSON pur : c'est ce que le modèle recevra (une Date devient sa
  // chaîne, un `undefined` disparaît), et on peut la raccourcir sur place.
  const work: unknown = JSON.parse(JSON.stringify(data) ?? 'null');

  // 1. Listes : de moitié en moitié, tant que les textes au minimum débordent.
  const omitted = new Map<unknown[], number>();
  while (tokensOf(capStrings(work, MIN_STRING_TOKENS)) + MARK_TOKENS * omitted.size > maxTokens) {
    const list = costliestArray(work);
    if (!list) break;
    const keep = Math.ceil(list.length / 2);
    omitted.set(list, (omitted.get(list) ?? 0) + list.length - keep);
    list.length = keep;
  }
  for (const [list, count] of omitted) list.push(`… [${count} éléments coupés]`);

  // 2. Textes : le plafond commun le plus haut qui tienne dans le budget.
  let lo = MIN_STRING_TOKENS;
  let hi = Math.max(MIN_STRING_TOKENS, maxStringTokens(work));
  let cap = MIN_STRING_TOKENS;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (tokensOf(capStrings(work, mid)) <= maxTokens) {
      cap = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  let fitted = capStrings(work, cap);
  let tokens = tokensOf(fitted);

  // 3. Filet : trop de petites valeurs (un objet à mille clés). On tranche le
  // JSON lui-même ; les guillemets échappés coûtent, d'où la marge.
  if (tokens > maxTokens) {
    const json = JSON.stringify(fitted) ?? 'null';
    fitted = { sortieTronquee: cutToTokens(json, Math.floor(maxTokens * 0.8)) };
    tokens = tokensOf(fitted);
  }
  return { data: fitted, cut: true, tokens, originalTokens };
}
