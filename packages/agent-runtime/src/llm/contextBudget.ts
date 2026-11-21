import type { OllamaMessage } from '@catdesk/shared-types';

/**
 * Prompt plus long que `num_ctx` : Ollama le coupe SANS erreur (veille du
 * 19/11, lynote-ai/local-ai-note-taker). Mesuré le 2026-11-20 sur la machine
 * cible (Ollama 0.32.14, qwen3:14b, num_ctx 8192) : tout prompt plus long
 * que la fenêtre est ramené à 4 098 tokens, et le modèle a cité avec aplomb
 * trois codes faux d'un document coupé. Personne ne le savait.
 *
 * `prompt_eval_count` donne le compte COMPLET quand le prompt tient, cache de
 * préfixe compris (2 096 tokens à froid comme à chaud), mais le compte APRÈS
 * coupe quand il déborde : seul, il ne voit rien. On estime donc la taille à
 * partir du texte envoyé, et le compteur départage.
 */

/**
 * Estimation calibrée le 2026-11-20 sur le tokenizer de qwen3 (14 textes :
 * docs markdown, prose française, anglais, Rust, TypeScript, JSON texte,
 * JSON chiffré, liste d'URL). Un ratio unique par caractère se trompait du
 * simple au double : les espaces d'alignement des tableaux markdown ne
 * coûtent presque rien (42 % d'un extrait de la doc), et qwen découpe chaque
 * chiffre en un token (vérifié : 1 000 chiffres = 1 000 tokens). D'où : un
 * token par chiffre, les blancs gratuits, le reste à 2,7 caractères par
 * token. Écart mesuré : 0,98 à 1,17 fois le réel en français, code et JSON
 * texte ; 0,86 sur du JSON chiffré à clés courtes ; jusqu'à 1,5 en anglais.
 * Seul le JSON indenté est nettement sous-estimé (0,71) : les sorties
 * d'outils partent compactes. Sur les vrais prompts du banc (prompt système
 * + schémas d'outils, 190 appels) : 1,28 à 1,36, car les clés anglaises des
 * schémas (`description`, `properties`) tiennent chacune en un token.
 */
export const CHARS_PER_TOKEN = 2.7;

/** Balises du gabarit de chat autour de chaque message (rôle, début, fin). */
const MESSAGE_OVERHEAD = 5;

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isBlank = (c: number): boolean =>
  c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x202f;

/** Tokens estimés d'un texte (prose, sortie d'outil ou schémas JSON). */
export function textTokens(text: string): number {
  let digits = 0;
  let blanks = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (isDigit(c)) digits++;
    else if (isBlank(c)) blanks++;
  }
  return Math.ceil(digits + (text.length - digits - blanks) / CHARS_PER_TOKEN);
}

/**
 * Début de `text` estimé à `maxTokens` au plus (même barème que `textTokens`),
 * coupé sur un blanc proche plutôt qu'au milieu d'un mot.
 */
export function cutToTokens(text: string, maxTokens: number): string {
  let cost = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    cost += isDigit(c) ? 1 : isBlank(c) ? 0 : 1 / CHARS_PER_TOKEN;
    if (cost <= maxTokens) continue;
    const blank = text.lastIndexOf(' ', i);
    let end = blank > 0 && blank > i - 40 ? blank : i;
    // Jamais la moitié d'une paire de substitution (émoji, idéogramme rare).
    const prev = text.charCodeAt(end - 1);
    if (prev >= 0xd800 && prev <= 0xdbff) end--;
    return text.slice(0, end);
  }
  return text;
}

/** Tokens d'un historique tel qu'il part à Ollama (contenu + tool calls rejoués). */
export function messagesTokens(messages: readonly OllamaMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += MESSAGE_OVERHEAD + textTokens(m.content);
    if (m.tool_calls) total += textTokens(JSON.stringify(m.tool_calls));
  }
  return total;
}

export interface ContextUsage {
  /** Taille du prompt : le compte d'Ollama s'il est entier, sinon l'estimation. */
  tokens: number;
  /** Le prompt dépassait la fenêtre : Ollama en a coupé une partie. */
  overflow: boolean;
}

/**
 * Un prompt qui tient donne un compte proche de l'estimation : au pire ~0,66
 * fois (anglais surestimé de 1,5). Un prompt coupé tombe à la moitié de la
 * fenêtre (4 098 pour 8 192), bien en dessous. Marges : il faudrait une
 * estimation à moins de 0,83 fois le réel pour manquer une coupe, à plus de
 * 1,67 pour en voir une à tort.
 */
const SHRUNK_BELOW = 0.6;
/** L'estimation doit au moins frôler la fenêtre pour qu'une coupe soit possible. */
const NEAR_WINDOW = 0.8;

export function contextUsage(opts: {
  estimated: number;
  promptEvalCount?: number | undefined;
  numCtx: number;
}): ContextUsage {
  const { estimated, promptEvalCount: counted, numCtx } = opts;
  if (counted === undefined) return { tokens: estimated, overflow: estimated > numCtx };
  // Fenêtre pleine au token près : coupé à num_ctx (autre version d'Ollama).
  if (counted >= numCtx - 16) return { tokens: Math.max(estimated, counted), overflow: true };
  if (estimated > NEAR_WINDOW * numCtx && counted < SHRUNK_BELOW * estimated) {
    return { tokens: estimated, overflow: true };
  }
  return { tokens: counted, overflow: false };
}

/**
 * Part de la fenêtre laissée au prompt : la réponse (`num_predict`) doit tenir
 * derrière, et l'estimation peut sous-compter un JSON très chiffré (0,86).
 */
const PROMPT_SHARE = 0.95;
/** Sortie d'outil jamais réduite sous ce plancher : le débordement sera signalé. */
export const MIN_TOOL_TOKENS = 300;

/**
 * Tokens qu'une sortie d'outil peut occuper pour que le prompt suivant tienne
 * dans `num_ctx` : la place restante, partagée entre les appels de l'étape qui
 * n'ont pas encore répondu.
 */
export function toolOutputBudget(opts: {
  /** Prompt déjà engagé : prompt système, schémas, historique du run. */
  used: number;
  numCtx: number;
  maxTokens: number;
  remainingCalls: number;
}): number {
  const room = Math.floor(PROMPT_SHARE * (opts.numCtx - opts.maxTokens)) - opts.used;
  const share = Math.floor(room / Math.max(1, opts.remainingCalls)) - MESSAGE_OVERHEAD;
  return Math.max(MIN_TOOL_TOKENS, share);
}

/** Mention ajoutée à la réponse quand un appel du run a débordé. */
export function overflowNotice(tokens: number, numCtx: number): string {
  return (
    `(Vérification : la demande dépassait la mémoire de travail du modèle, environ ${tokens} tokens pour ${numCtx}. ` +
    'Une partie du contexte a été ignorée. Pour un long document, demande une partie précise.)'
  );
}
