/**
 * Nettoyage des caractères invisibles (étage « L0 ») : ce qu'un humain ne voit
 * pas à l'écran mais que le modèle lit. Une page piégée peut cacher une consigne
 * dans le bloc Unicode Tags (U+E0000–E007F, invisible mais lu par le tokenizer),
 * l'entourer de contrôles bidi, ou couper ses mots avec des caractères de largeur
 * nulle pour échapper aux motifs de `sanitizeToolOutput`.
 *
 * D'après l'étage L0 décrit par guard-spec (https://github.com/guard-spec/guard-spec,
 * `internal/sanitizer`, Apache-2.0), réécrit en TypeScript sans en reprendre le
 * code. Écarts voulus :
 * - **pas de NFKC global** : il changerait le texte légitime que lit le modèle
 *   (« … » → « ... », espaces insécables, m² → m2) et les noms de fichiers NFD
 *   qu'il réutilise ensuite comme chemins. Seules la pleine chasse et l'alphabet
 *   mathématique, qui servent à déguiser un texte, sont ramenés en ASCII ;
 * - ni passe HTML ni score d'homoglyphes : on nettoie et on journalise, on ne
 *   bloque jamais.
 *
 * Pur et sans dépendance : appelé sur chaque sortie d'outil, chaque message de
 * l'utilisateur et chaque article de presse.
 */

export type InvisibleCategory =
  | 'surrogate' // demi-paire UTF-16 isolée (l'équivalent JS d'un UTF-8 invalide)
  | 'ansi' // séquence d'échappement de terminal
  | 'control' // caractère de contrôle (hors tabulation et sauts de ligne)
  | 'tag' // bloc Tags, U+E0000–E007F
  | 'bidi' // contrôle de direction (RLO, isolats…)
  | 'variation' // sélecteur de variante
  | 'zeroWidth' // autre caractère ignorable par défaut (largeur nulle, BOM, trait d'union conditionnel…)
  | 'folded' // pleine chasse ou lettre mathématique ramenée en ASCII
  | 'marker'; // imitation d'un marqueur de cadrage de CatDesk

export type InvisibleCounts = Partial<Record<InvisibleCategory, number>>;

export interface CleanResult {
  text: string;
  removed: InvisibleCounts;
}

/**
 * Retirer un caractère peut en démasquer un autre : on repasse jusqu'à
 * stabilité. L'ordre des étapes règle déjà les cas connus ; la boucle est le filet.
 */
const MAX_PASSES = 8;

/**
 * Chemin rapide : un texte sans aucun caractère que les passes retirent ou
 * replient (le cas de presque toute prose, accents compris) ne paie qu'un
 * balayage, plus la passe des marqueurs, qui sont en caractères ordinaires.
 * L'ASCII imprimable d'abord : le test le moins cher (captures base64 de 3 Mo).
 */
const PRINTABLE_ASCII = /^[\x20-\x7e\t\n\r]*$/;
const CANDIDATE = /[\p{Cs}\p{Default_Ignorable_Code_Point}\uFF01-\uFF5E\u{1D400}-\u{1D7FF}]/u;
const CANDIDATE_CONTROL = /[^\P{Cc}\t\n\r]/u;

const SURROGATE = /\p{Cs}/gu;
const ANSI =
  // eslint-disable-next-line no-control-regex -- ESC (U+001B), BEL et CSI 8 bits (U+009B) visés exprès
  /\u001b\][^\u0007\u001b\n]{0,512}(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]|\u009b[0-?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/gu;
// eslint-disable-next-line no-control-regex -- ESC, CSI et BEL (fin d'OSC) exclus ici, retirés après l'ANSI
const CONTROL_EXCEPT_ESC = /[^\P{Cc}\t\n\r\u0007\u001b\u009b]/gu;
// eslint-disable-next-line no-control-regex -- ESC, CSI et BEL restés seuls après l'ANSI
const LONE_ESC = /[\u0007\u001b\u009b]/gu;
const TAG = /[\u{E0000}-\u{E007F}]/gu;
const BIDI = /\p{Bidi_Control}/gu;
const VARIATION = /\p{Variation_Selector}/gu;
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const FULLWIDTH = /[\uFF01-\uFF5E]/gu;
const MATH_ALPHANUMERIC = /[\u{1D400}-\u{1D7FF}]/gu;

/**
 * Imitations des marqueurs que `sanitizeToolOutput` pose autour d'un contenu
 * suspect : une page qui écrit elle-même « [FIN DU CONTENU EXTERNE NON FIABLE] »
 * ferait croire au modèle que la suite vient de CatDesk. Le texte des marqueurs
 * vit dans `sanitizeToolOutput.ts` ; un test vérifie que ces motifs l'attrapent.
 */
const MARKER_BRACKETED = /\[\s*(?:FIN\s+DU\s+)?CONTENU\s+EXTERNE\s+NON\s+FIABLE[^\]\n]*\]/giu;
const MARKER_BARE = /(?:FIN\s+DU\s+)?CONTENU\s+EXTERNE\s+NON\s+FIABLE/giu;
const MARKER_REPLACEMENT = '[marqueur retiré]';

function add(counts: InvisibleCounts, category: InvisibleCategory, n: number): void {
  if (n > 0) counts[category] = (counts[category] ?? 0) + n;
}

function strip(
  text: string,
  re: RegExp,
  category: InvisibleCategory,
  counts: InvisibleCounts,
  replacement = '',
): string {
  let n = 0;
  const out = text.replace(re, () => {
    n++;
    return replacement;
  });
  add(counts, category, n);
  return out;
}

function fold(text: string, counts: InvisibleCounts): string {
  let n = 0;
  const out = text
    .replace(FULLWIDTH, ch => {
      n++;
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    })
    .replace(MATH_ALPHANUMERIC, ch => {
      const plain = ch.normalize('NFKC');
      if (plain !== ch) n++;
      return plain;
    });
  add(counts, 'folded', n);
  return out;
}

function neutralizeMarkers(text: string, counts: InvisibleCounts): string {
  const bracketed = strip(text, MARKER_BRACKETED, 'marker', counts, MARKER_REPLACEMENT);
  // Le remplacement ne contient pas la phrase : la seconde passe ne le recompte pas.
  return strip(bracketed, MARKER_BARE, 'marker', counts, MARKER_REPLACEMENT);
}

function pass(text: string, counts: InvisibleCounts): string {
  let out = strip(text, SURROGATE, 'surrogate', counts, '\uFFFD');
  out = strip(out, TAG, 'tag', counts);
  out = strip(out, BIDI, 'bidi', counts);
  out = strip(out, VARIATION, 'variation', counts);
  out = strip(out, IGNORABLE, 'zeroWidth', counts);
  // Le repli avant l'ANSI : un crochet pleine chasse peut en cacher une.
  out = fold(out, counts);
  // L'ANSI après tout ce qui peut couper une séquence (ZWSP, autre contrôle,
  // pleine chasse), et AVANT de retirer ESC : sinon « [31m » resterait en clair
  // sans plus rien pour le reconnaître. Répétée, car retirer une séquence peut
  // en recoller une autre autour d'elle.
  out = strip(out, CONTROL_EXCEPT_ESC, 'control', counts);
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = strip(out, ANSI, 'ansi', counts);
  }
  out = strip(out, LONE_ESC, 'control', counts);
  return neutralizeMarkers(out, counts);
}

/** Retire l'invisible d'un texte et compte ce qui a été retiré, par catégorie. */
export function cleanInvisible(input: string): CleanResult {
  const removed: InvisibleCounts = {};
  const nothingToDo =
    PRINTABLE_ASCII.test(input) || (!CANDIDATE.test(input) && !CANDIDATE_CONTROL.test(input));
  if (nothingToDo) {
    return { text: neutralizeMarkers(input, removed), removed };
  }
  let text = input;
  for (let i = 0; i < MAX_PASSES; i++) {
    const next = pass(text, removed);
    if (next === text) break;
    text = next;
  }
  return { text, removed };
}

/** Nombre total de caractères retirés ou remplacés. */
export function totalRemoved(counts: InvisibleCounts): number {
  let total = 0;
  for (const n of Object.values(counts)) total += n ?? 0;
  return total;
}

function mergeInto(target: InvisibleCounts, source: InvisibleCounts): void {
  for (const [category, n] of Object.entries(source) as Array<[InvisibleCategory, number]>) {
    add(target, category, n);
  }
}

/**
 * Valeurs que le modèle réutilise telles quelles dans un appel d'outil suivant
 * (chemin, URL) : les modifier ferait échouer `read_file` sur un nom qui contient
 * un caractère invisible. On les compte sans y toucher.
 */
const VERBATIM_KEYS = new Set([
  'path',
  'paths',
  'filepath',
  'absolutepath',
  'file',
  'files',
  'dir',
  'directory',
  'cwd',
  'url',
  'urls',
  'href',
  'link',
]);

export interface ToolDataCleaner {
  /** À passer en second argument de `JSON.stringify`. */
  replacer: (this: unknown, key: string, value: unknown) => unknown;
  /** Ce qui a été retiré, toutes chaînes et clés confondues. */
  readonly removed: InvisibleCounts;
  /** Chaînes laissées intactes (chemins, URL) alors qu'elles contiennent de l'invisible. */
  readonly keptVerbatim: number;
}

/**
 * Nettoyeur pour la sortie d'un outil, appliqué PENDANT la sérialisation : après,
 * `JSON.stringify` a déjà changé ESC en texte `\u001b` et l'ANSI ne se reconnaît
 * plus. Le *replacer* reçoit les valeurs après `toJSON`, donc une `Date` arrive
 * déjà en chaîne.
 */
export function createToolDataCleaner(): ToolDataCleaner {
  const removed: InvisibleCounts = {};
  let keptVerbatim = 0;
  const verbatimArrays = new WeakSet<object>();

  const cleanKeys = (obj: Record<string, unknown>): Record<string, unknown> => {
    let changed = false;
    const entries = Object.keys(obj).map(key => {
      const r = cleanInvisible(key);
      if (r.text !== key) {
        changed = true;
        mergeInto(removed, r.removed);
      }
      return [r.text, obj[key]] as const;
    });
    return changed ? Object.fromEntries(entries) : obj;
  };

  function replacer(this: unknown, key: string, value: unknown): unknown {
    const inVerbatimArray = typeof this === 'object' && this !== null && verbatimArrays.has(this);
    const verbatim = inVerbatimArray || VERBATIM_KEYS.has(key.toLowerCase());
    if (typeof value === 'string') {
      const r = cleanInvisible(value);
      if (r.text === value) return value;
      if (verbatim) {
        keptVerbatim++;
        return value;
      }
      mergeInto(removed, r.removed);
      return r.text;
    }
    if (Array.isArray(value)) {
      if (verbatim) verbatimArrays.add(value);
      return value;
    }
    if (value !== null && typeof value === 'object') {
      return cleanKeys(value as Record<string, unknown>);
    }
    return value;
  }

  return {
    replacer,
    get removed() {
      return removed;
    },
    get keptVerbatim() {
      return keptVerbatim;
    },
  };
}
