/**
 * Découpe un flux de tokens en phrases prêtes à être dites.
 *
 * C'est ce qui donne l'impression « Jarvis » : la première phrase part vers
 * la synthèse dès qu'elle est complète, pendant que le modèle écrit la suite.
 * Deux exigences en tension : couper tôt (latence) sans couper faux
 * (« M. Dupont », « 3.14 », un numéro de liste). Pur, sans état global : une
 * instance par réponse.
 */

export interface SentenceChunker {
  /** Ajoute un token ; renvoie les phrases devenues complètes (déjà « orales »). */
  push(token: string): string[];
  /** Fin de flux : ce qui reste, s'il y a quelque chose à dire. */
  flush(): string[];
  reset(): void;
}

/** Au-delà, on coupe à la virgule la plus proche : une phrase-fleuve retarderait tout. */
const MAX_PENDING_CHARS = 280;

/**
 * Abréviations françaises usuelles suivies d'un point qui n'est PAS une fin de
 * phrase. Comparées en minuscules, sans le point.
 */
const ABBREVIATIONS = new Set([
  'm',
  'mm',
  'mme',
  'mlle',
  'dr',
  'pr',
  'me',
  'st',
  'ste',
  'etc',
  'ex',
  'cf',
  'vs',
  'p',
  'pp',
  'n',
  'no',
  'av',
  'env',
  'tél',
  'réf',
  'chap',
  'fig',
  'vol',
  'éd',
  'art',
  'max',
  'min',
]);

/** Fin de phrase : ponctuation forte, guillemets/parenthèses fermants, puis blanc. */
const SENTENCE_END = /[.!?…]+["»)\]]*\s/g;

export function createSentenceChunker(): SentenceChunker {
  let buffer = '';

  const take = (end: number): string => {
    const raw = buffer.slice(0, end);
    buffer = buffer.slice(end);
    return raw;
  };

  const extract = (): string[] => {
    const out: string[] = [];
    // Boucle : à chaque tour, soit on sort une phrase, soit on s'arrête.
    for (;;) {
      // Bloc de code : rien ne sort tant qu'il n'est pas refermé ; fermé, il
      // devient une seule phrase de remplacement.
      const fence = buffer.indexOf('```');
      if (fence !== -1) {
        const close = buffer.indexOf('```', fence + 3);
        if (close === -1) {
          // Ce qui précède l'ouverture peut partir tout de suite.
          const before = buffer.slice(0, fence);
          if (before.trim()) {
            const sentence = toSpeakable(before);
            buffer = buffer.slice(fence);
            if (sentence) out.push(sentence);
            continue;
          }
          break;
        }
        const before = buffer.slice(0, fence);
        buffer = buffer.slice(close + 3);
        const sentence = toSpeakable(before);
        if (sentence) out.push(sentence);
        out.push('Bloc de code omis.');
        continue;
      }

      const cut = findBoundary(buffer);
      if (cut === -1) break;
      const sentence = toSpeakable(take(cut));
      if (sentence) out.push(sentence);
    }
    return out;
  };

  return {
    push(token) {
      buffer += token;
      return extract();
    },
    flush() {
      const rest = buffer.replace(/```/g, ' ');
      buffer = '';
      const sentence = toSpeakable(rest);
      return sentence ? [sentence] : [];
    },
    reset() {
      buffer = '';
    },
  };
}

/**
 * Indice (exclusif) de la fin de la première phrase complète de `text`, ou -1.
 * Une phrase n'est complète que si un blanc la SUIT : « 3. » en fin de tampon
 * peut encore devenir « 3.14 ».
 */
function findBoundary(text: string): number {
  // Retour à la ligne : un item de liste, un titre, un paragraphe.
  const newline = text.indexOf('\n');

  SENTENCE_END.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_END.exec(text)) !== null) {
    const end = match.index + match[0].length;
    if (newline !== -1 && newline < match.index) break;
    const candidate = text.slice(0, end);
    if (isFalseEnd(candidate)) continue;
    return end;
  }

  // Une ligne (item, titre, ou vide — alors rien n'en sortira) est une unité.
  if (newline !== -1) return newline + 1;

  if (text.length > MAX_PENDING_CHARS) {
    const head = text.slice(0, MAX_PENDING_CHARS);
    const comma = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(' : '));
    if (comma > 40) return comma + 2;
    const space = head.lastIndexOf(' ');
    if (space > 40) return space + 1;
  }
  return -1;
}

/** « M. », « etc. », « 1. » (numéro de liste), initiale « J. » : pas une fin. */
function isFalseEnd(candidate: string): boolean {
  const trimmed = candidate.trimEnd().replace(/["»)\]]+$/, '');
  if (!trimmed.endsWith('.')) return false; // ! ? … ne sont jamais des abréviations
  const words = trimmed.slice(0, -1).split(/\s+/);
  const last = words[words.length - 1] ?? '';
  const bare = last.replace(/^[("«[]+/, '').toLowerCase();
  if (ABBREVIATIONS.has(bare)) return true;
  if (/^[a-zà-ÿ]$/i.test(bare)) return true; // initiale
  if (/^\d+$/.test(bare) && words.length === 1) return true; // « 1. » en tête d'item
  return !hasLetters(trimmed);
}

function hasLetters(text: string): boolean {
  return /\p{L}{2,}/u.test(text);
}

/**
 * Markdown → texte à dire. On garde le sens, on jette la typographie : une
 * voix qui lit « astérisque astérisque » n'est pas un assistant.
 */
export function toSpeakable(markdown: string): string {
  return (
    markdown
      // Images et liens : le texte, jamais l'URL.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, 'lien')
      // Code en ligne : le contenu.
      .replace(/`([^`]*)`/g, '$1')
      // Gras / italique (paires seulement — pas le snake_case).
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s.,;:!?)]|$)/g, '$1$2')
      .replace(/(^|[\s(])_(?!\s)(.+?)_(?=[\s.,;:!?)]|$)/g, '$1$2')
      // Titres, listes, citations, filets — en début de ligne.
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
      // Tableaux : la ligne de séparation disparaît, les barres deviennent des virgules.
      .replace(/^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, '')
      .replace(/[ \t]*\|[ \t]*/g, ', ')
      .replace(/^,[ \t]*|,[ \t]*$/gm, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
