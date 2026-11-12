// Données personnelles dans ce qui SORT de CatDesk (veille du 7/11, piste 2).
//
// Le modèle est local : masquer ce qu'il LIT casserait « quel numéro dans ce
// mail ? ». On ne masque donc que ce qu'un outil envoie à un service externe
// (webhook, Discord, API), et AVANT le dialogue de confirmation, pour que
// l'utilisateur voie ce qui part vraiment.
//
// Trois niveaux :
//  - masqué : la forme ET la somme de contrôle passent (Luhn, mod 97, clé du
//    NIR) — remplacé par « [IBAN masqué] » ;
//  - à vérifier : la forme passe, la somme de contrôle non — laissé tel quel,
//    signalé (un numéro de commande à 16 chiffres n'est pas une carte) ;
//  - signalé : e-mail ou téléphone, masqués seulement là où on le demande
//    (Discord, choix de l'utilisateur du 12/11), signalés ailleurs.
//
// Les caractères invisibles sont retirés d'abord (invisibleChars) : sinon un
// espace de largeur nulle glissé dans un IBAN le ferait passer, et un texte en
// bloc Tags partirait sans que le dialogue le montre.

import { cleanInvisible, totalRemoved } from './invisibleChars';

export type PersonalDataKind = 'card' | 'iban' | 'nir' | 'phone' | 'email';
export type PersonalDataLevel = 'masked' | 'suspect' | 'flagged';

export interface PersonalDataFinding {
  readonly kind: PersonalDataKind;
  readonly level: PersonalDataLevel;
}

export interface PersonalDataSummary {
  readonly findings: readonly PersonalDataFinding[];
  /** Caractères invisibles retirés avant la détection. */
  readonly invisibleRemoved: number;
}

export interface PersonalDataScan extends PersonalDataSummary {
  readonly text: string;
}

export interface ScanOptions {
  /** Masquer aussi e-mails et téléphones (Discord) ; sinon ils sont seulement signalés. */
  readonly maskContacts?: boolean;
}

const PLACEHOLDER: Record<PersonalDataKind, string> = {
  card: '[carte masquée]',
  iban: '[IBAN masqué]',
  nir: '[n° de sécurité sociale masqué]',
  phone: '[téléphone masqué]',
  email: '[e-mail masqué]',
};

// ─── Sommes de contrôle ───────────────────────────────────────

export function luhnOk(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Préfixe d'émetteur (IIN) cohérent avec la longueur. Les longueurs retenues
 * (15, 16, 19) écartent un SIRET (14 chiffres) et un horodatage en
 * millisecondes (13).
 */
function cardBrandOk(d: string): boolean {
  const len = d.length;
  if (/^3[47]/.test(d)) return len === 15; // American Express
  if (/^4/.test(d)) return len === 16 || len === 19; // Visa (et CB co-marquée)
  if (/^(?:5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/.test(d)) return len === 16; // Mastercard
  if (/^(?:6011|64[4-9]|65|62)/.test(d)) return len === 16 || len === 19; // Discover, UnionPay
  if (/^35(?:2[89]|[3-8]\d)/.test(d)) return len === 16 || len === 19; // JCB
  return false;
}

export function ibanChecksumOk(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    // Lettres : A = 10 … Z = 35, chiffre par chiffre pour rester sous 2^53.
    const value = code >= 65 ? String(code - 55) : ch;
    for (const digit of value) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest === 1;
}

/** Clé du NIR : 97 − (13 premiers chiffres mod 97), Corse 2A → 19, 2B → 18. */
export function nirKeyOk(nir: string): boolean {
  const body = nir.slice(0, 13).replace('2A', '19').replace('2B', '18');
  const key = Number(nir.slice(13));
  return 97 - (Number(body) % 97) === key;
}

// Longueurs d'IBAN des pays SEPA et de quelques pays francophones. Seuls ces
// pays sont reconnus : sans longueur connue, une suite de lettres et de
// chiffres réussit le mod 97 une fois sur 97, bien trop souvent.
const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24,
  AT: 20,
  BE: 16,
  BG: 22,
  CH: 21,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  EE: 20,
  ES: 24,
  FI: 18,
  FR: 27,
  GB: 22,
  GI: 23,
  GR: 27,
  HR: 21,
  HU: 28,
  IE: 22,
  IS: 26,
  IT: 27,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  MA: 28,
  MC: 27,
  MT: 31,
  NL: 18,
  NO: 15,
  PL: 28,
  PT: 25,
  RO: 24,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  TN: 24,
  VA: 22,
};

// ─── Détecteurs ───────────────────────────────────────────────

// Un blanc dans un numéro : espace, insécable ou fine (\s), jamais un saut de ligne.
const BLANK = /[^\S\r\n]/;
const ALNUM = /[A-Za-z0-9]/;

const IBAN_START = /(?<![A-Za-z0-9])[A-Za-z]{2}\d{2}/g;

// 13 à 19 chiffres, groupés ou non. Le regard arrière refuse de démarrer au
// milieu d'une suite (« 1234 5678 … ») ; le regard avant, de s'arrêter au milieu.
const CARD_CANDIDATE =
  /(?<![\w.,]|\d(?:[^\S\r\n]|-))\d(?:(?:[^\S\r\n]|-)?\d){12,18}(?![\w]|(?:[^\S\r\n]|-)\d|[.,]\d)/g;

// NIR : sexe (1, 2, 3, 4, 7, 8), 14 autres caractères dont « 2A »/« 2B » pour la Corse.
const NIR_CANDIDATE =
  /(?<![\w.,]|\d[^\S\r\n])[1-478](?:[^\S\r\n]?[0-9ABab]){14}(?![\w]|[^\S\r\n]\d)/g;
const NIR_SHAPE = /^[1-478]\d{2}(?:0[1-9]|1[0-2]|[2-9]\d)(?:\d{2}|2[AB])\d{8}$/;

const EMAIL = /(?<![\w.%+-])[\w.%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}(?![\w-])/g;

// Formats français : 06 12 34 56 78, 06.12.34.56.78, 0612345678, +33 6 12 34 56 78,
// +33 (0)6 …, 0033 6 …
const PHONE =
  /(?<![\w+.,])(?:(?:\+|00)33(?:[^\S\r\n]|[.-])?(?:\(0\)(?:[^\S\r\n]|[.-])?)?|0)[1-9](?:(?:[^\S\r\n]|[.-])?\d{2}){4}(?![\w]|[.,]\d)/g;

function scanIbans(text: string, found: PersonalDataFinding[]): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(IBAN_START)) {
    const start = m.index;
    if (start < last) continue;
    const length = IBAN_LENGTHS[m[0].slice(0, 2).toUpperCase()];
    if (length === undefined) continue;

    // Lettres et chiffres jusqu'à la longueur du pays, un seul blanc permis entre deux.
    let compact = m[0].toUpperCase();
    let i = start + m[0].length;
    while (compact.length < length && i < text.length) {
      const c = text.charAt(i);
      if (ALNUM.test(c)) {
        compact += c.toUpperCase();
        i++;
      } else if (BLANK.test(c) && ALNUM.test(text.charAt(i + 1))) {
        i++;
      } else break;
    }
    if (compact.length !== length || ALNUM.test(text.charAt(i))) continue;

    if (ibanChecksumOk(compact)) {
      found.push({ kind: 'iban', level: 'masked' });
      out += text.slice(last, start) + PLACEHOLDER.iban;
      last = i;
    } else {
      found.push({ kind: 'iban', level: 'suspect' });
    }
  }
  return out + text.slice(last);
}

function scanCards(text: string, found: PersonalDataFinding[]): string {
  return text.replace(CARD_CANDIDATE, match => {
    const digits = match.replace(/\D/g, '');
    if (!cardBrandOk(digits)) return match;
    if (luhnOk(digits)) {
      found.push({ kind: 'card', level: 'masked' });
      return PLACEHOLDER.card;
    }
    found.push({ kind: 'card', level: 'suspect' });
    return match;
  });
}

function scanNirs(text: string, found: PersonalDataFinding[]): string {
  return text.replace(NIR_CANDIDATE, match => {
    const compact = match.replace(/\s/g, '').toUpperCase();
    if (!NIR_SHAPE.test(compact)) return match;
    if (nirKeyOk(compact)) {
      found.push({ kind: 'nir', level: 'masked' });
      return PLACEHOLDER.nir;
    }
    found.push({ kind: 'nir', level: 'suspect' });
    return match;
  });
}

function scanContacts(
  text: string,
  kind: 'email' | 'phone',
  pattern: RegExp,
  mask: boolean,
  found: PersonalDataFinding[],
): string {
  return text.replace(pattern, match => {
    found.push({ kind, level: mask ? 'masked' : 'flagged' });
    return mask ? PLACEHOLDER[kind] : match;
  });
}

/**
 * Masque ou signale les données personnelles d'un texte qui va SORTIR.
 * Idempotent : un texte déjà masqué ne contient plus rien à masquer (les
 * remplacements n'ont ni chiffre ni arobase).
 */
export function scanPersonalData(input: string, opts: ScanOptions = {}): PersonalDataScan {
  const cleaned = cleanInvisible(input);
  const found: PersonalDataFinding[] = [];
  const mask = opts.maskContacts === true;
  // IBAN d'abord : ses chiffres feraient sinon un faux numéro de carte.
  let text = scanIbans(cleaned.text, found);
  text = scanCards(text, found);
  text = scanNirs(text, found);
  // E-mail avant téléphone : un numéro dans une adresse part avec elle.
  text = scanContacts(text, 'email', EMAIL, mask, found);
  text = scanContacts(text, 'phone', PHONE, mask, found);
  return { text, findings: found, invisibleRemoved: totalRemoved(cleaned.removed) };
}

// ─── Résumé pour l'utilisateur ────────────────────────────────

const LABELS: Record<PersonalDataKind, readonly [string, string]> = {
  card: ['numéro de carte', 'numéros de carte'],
  iban: ['IBAN', 'IBAN'],
  nir: ['numéro de sécurité sociale', 'numéros de sécurité sociale'],
  phone: ['téléphone', 'téléphones'],
  email: ['e-mail', 'e-mails'],
};

function countByKind(findings: readonly PersonalDataFinding[], level: PersonalDataLevel): string {
  const counts = new Map<PersonalDataKind, number>();
  for (const f of findings) {
    if (f.level === level) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  }
  return [...counts].map(([kind, n]) => `${n} ${LABELS[kind][n > 1 ? 1 : 0]}`).join(', ');
}

export function mergeSummaries(summaries: readonly PersonalDataSummary[]): PersonalDataSummary {
  return {
    findings: summaries.flatMap(s => s.findings),
    invisibleRemoved: summaries.reduce((n, s) => n + s.invisibleRemoved, 0),
  };
}

/**
 * Une phrase pour le dialogue de confirmation et le résultat de l'outil, ou
 * `undefined` s'il n'y a rien à dire.
 */
export function describePersonalData(summary: PersonalDataSummary): string | undefined {
  const parts: string[] = [];
  const masked = countByKind(summary.findings, 'masked');
  const suspect = countByKind(summary.findings, 'suspect');
  const flagged = countByKind(summary.findings, 'flagged');
  if (masked) parts.push(`Masqué avant envoi : ${masked}.`);
  if (suspect) {
    parts.push(
      `À vérifier, envoyé tel quel (la forme y est, pas la somme de contrôle) : ${suspect}.`,
    );
  }
  if (flagged) parts.push(`Envoyé tel quel, à toi de voir : ${flagged}.`);
  if (summary.invisibleRemoved > 0) {
    parts.push(`Caractères invisibles retirés : ${summary.invisibleRemoved}.`);
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

// ─── Arguments d'un outil sortant ─────────────────────────────

export interface MaskedArgs {
  readonly args: Record<string, unknown>;
  readonly summary: PersonalDataSummary;
}

/**
 * Masque les champs texte nommés d'arguments BRUTS (pas encore validés par
 * zod) : un champ absent ou d'un autre type est laissé tel quel, la
 * validation de l'outil le refusera.
 */
export function maskTextFields(
  args: Record<string, unknown>,
  fields: readonly string[],
  opts: ScanOptions,
): MaskedArgs {
  const out: Record<string, unknown> = { ...args };
  const scans: PersonalDataScan[] = [];
  for (const field of fields) {
    const value = args[field];
    if (typeof value !== 'string') continue;
    const scan = scanPersonalData(value, opts);
    scans.push(scan);
    out[field] = scan.text;
  }
  return { args: out, summary: mergeSummaries(scans) };
}

/** Forme attendue par le registre d'outils (`RegisteredTool.prepareOutboundArgs`). */
export function toOutbound(masked: MaskedArgs): {
  args: Record<string, unknown>;
  notice?: string;
} {
  const notice = describePersonalData(masked.summary);
  return notice !== undefined ? { args: masked.args, notice } : { args: masked.args };
}
