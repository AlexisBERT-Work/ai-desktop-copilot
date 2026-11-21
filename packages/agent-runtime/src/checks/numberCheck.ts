/**
 * Chiffres, liens et adresses de la réponse retrouvés dans les sources du tour.
 *
 * qwen3:14b recopie mal un cours, un pourcentage ou une URL : rien ne le
 * signalait. Ici, tout ce qui ressemble à une donnée (nombre décimal, %, €,
 * nombre ≥ 100, lien, e-mail) doit figurer dans ce que les outils ont renvoyé,
 * ou dans la demande. Sinon la réponse est ANNOTÉE, jamais bloquée : un calcul
 * fait par le modèle (une moyenne, un écart) est légitime et ne s'y trouve pas.
 *
 * Idée reprise de Replyze/ai-customer-support-agent (veille du 19/11, MIT) :
 * aucun code repris, la logique est réécrite.
 */

/** Outils dont la sortie est une SOURCE : après eux, un chiffre doit en venir. */
export const SOURCE_TOOLS: ReadonlySet<string> = new Set([
  'search_dailies',
  'get_market',
  'read_webpage',
  'browser_get_text',
  'parse_document',
  'analyze_data',
  'read_email',
]);

interface Candidate {
  value: number;
  /** Écart admis : la moitié de la dernière décimale écrite (187,45 couvre 187,4523). */
  tolerance: number;
}

/** Nombre écrit à la française ou à l'anglaise : « 1 234,56 », « 1,234.56 », « 12,5 ». */
const NUMBER_SOURCE =
  '[-+−]?(?:\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)*)';

/** Unité ou échelle collée au nombre dans la réponse. */
const UNIT_SOURCE =
  '(?:\\s?(%|€|\\$|£|pts?|points?|k|K|M|Mds?|millions?|milliards?|mille|euros?|dollars?))?';

const ANSWER_FIGURE = new RegExp(
  `(?<![\\p{L}\\p{N}.,])([$€£]\\s?)?(${NUMBER_SOURCE})${UNIT_SOURCE}(?![\\p{L}\\p{N}])`,
  'gu',
);

const SOURCE_NUMBER = new RegExp(`(?<![\\p{L}\\p{N}.,])${NUMBER_SOURCE}`, 'gu');

const URL = /\bhttps?:\/\/[^\s<>()"'[\]]+/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

const SCALE: Readonly<Record<string, number>> = {
  k: 1e3,
  mille: 1e3,
  m: 1e6,
  million: 1e6,
  millions: 1e6,
  md: 1e9,
  mds: 1e9,
  milliard: 1e9,
  milliards: 1e9,
};

/**
 * Lectures possibles d'un nombre écrit. Une seule virgule suivie de 3 chiffres
 * est ambiguë (« 1,234 » : 1,234 en français, 1 234 en anglais) : les deux
 * lectures sont gardées, et l'une suffit.
 */
export function readings(raw: string): Array<{ value: number; decimals: number }> {
  const sign = /^[-−]/.test(raw) ? -1 : 1;
  const body = raw.replace(/^[-+−]/, '');
  // \s couvre l'espace, l'insécable et l'insécable fine : NUMBER_SOURCE n'en laisse pas d'autre.
  const spaced = /\s/.test(body);
  const compact = body.replace(/\s/g, '');
  const out: Array<{ value: number; decimals: number }> = [];
  const push = (text: string, decimals: number): void => {
    const value = Number(text);
    if (Number.isFinite(value)) out.push({ value: sign * value, decimals });
  };

  const commas = (compact.match(/,/g) ?? []).length;
  const dots = (compact.match(/\./g) ?? []).length;
  if (commas === 0 && dots === 0) {
    push(compact, 0);
  } else if (commas > 0 && dots > 0) {
    // Le dernier séparateur est la décimale, l'autre groupe les milliers.
    const decimalSep = compact.lastIndexOf(',') > compact.lastIndexOf('.') ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    const normalized = compact.split(thousandSep).join('').replace(decimalSep, '.');
    push(normalized, normalized.split('.')[1]?.length ?? 0);
  } else {
    const sep = commas > 0 ? ',' : '.';
    const parts = compact.split(sep);
    const count = parts.length - 1;
    const last = parts.at(-1) ?? '';
    if (count === 1 && !spaced) push(compact.replace(sep, '.'), last.length);
    if (count > 1 || last.length === 3 || spaced) {
      if (parts.slice(1).every(p => p.length === 3)) push(parts.join(''), 0);
      else if (spaced && count === 1) push(compact.replace(sep, '.'), last.length);
    }
  }
  return out;
}

function candidates(raw: string, unit: string | undefined): Candidate[] {
  const scale = unit ? (SCALE[unit.toLowerCase()] ?? 1) : 1;
  const out: Candidate[] = [];
  for (const { value, decimals } of readings(raw)) {
    const tolerance = 0.5 * 10 ** -decimals;
    out.push({ value: value * scale, tolerance: tolerance * scale });
    // « 1,2 Md€ » dans la source comme dans la réponse : l'échelle est la même des deux côtés.
    if (scale !== 1) out.push({ value, tolerance });
    // Une source donne souvent un pourcentage en fraction (0,123 pour 12,3 %).
    if (unit === '%') out.push({ value: value / 100, tolerance: tolerance / 100 });
  }
  return out;
}

/**
 * Le nombre porte-t-il une donnée ? Les petits entiers sont des comptes (« 3
 * articles »), des jours ou des heures. Une année (quatre chiffres collés, de
 * l'an 1000 à 2100) vient de la date du tour ou de la culture générale du
 * modèle (« Germinal, 1885 ») : pas une donnée à sourcer.
 */
function isSignificant(raw: string, unit: string | undefined, currency: boolean): boolean {
  if (unit || currency) return true;
  const all = readings(raw);
  if (all.some(r => r.decimals > 0)) return true;
  const value = Math.abs(all[0]?.value ?? 0);
  if (/^\d{4}$/.test(raw) && value >= 1000 && value <= 2100) return false;
  return value >= 100;
}

function sourceNumbers(sources: readonly string[]): number[] {
  const values: number[] = [];
  for (const text of sources) {
    for (const m of text.matchAll(SOURCE_NUMBER)) {
      for (const r of readings(m[0])) values.push(Math.abs(r.value));
    }
  }
  return values;
}

function trimUrl(url: string): string {
  return url.replace(/[.,;:!?)»]+$/, '');
}

/**
 * Données de la réponse introuvables dans les sources, telles qu'écrites dans
 * la réponse (sans doublon, dans l'ordre). Comparaison en valeur absolue :
 * « une baisse de 1,2 % » correspond à `-1.2` dans la source.
 */
export function findUnsourcedFigures(answer: string, sources: readonly string[]): string[] {
  const haystack = sources.join('\n');
  const lowerHaystack = haystack.toLowerCase();
  const missing: string[] = [];
  const add = (text: string): void => {
    if (!missing.includes(text)) missing.push(text);
  };

  let rest = answer;
  for (const m of answer.matchAll(URL)) {
    const url = trimUrl(m[0]);
    if (!haystack.includes(url) && !haystack.includes(url.replace(/\/$/, ''))) add(url);
    rest = rest.replace(m[0], ' ');
  }
  for (const m of rest.matchAll(EMAIL)) {
    if (!lowerHaystack.includes(m[0].toLowerCase())) add(m[0]);
    rest = rest.replace(m[0], ' ');
  }

  const known = sourceNumbers(sources);
  for (const m of rest.matchAll(ANSWER_FIGURE)) {
    const currency = m[1] !== undefined;
    const raw = m[2] ?? '';
    const unit = m[3];
    if (!isSignificant(raw, unit, currency)) continue;
    const found = candidates(raw, unit).some(c =>
      known.some(k => Math.abs(k - Math.abs(c.value)) <= c.tolerance + 1e-9 * Math.abs(c.value)),
    );
    if (!found) add(m[0].trim());
  }
  return missing;
}

/** Mention ajoutée à la réponse : au plus trois données citées, pour rester lisible et audible. */
export function figuresNotice(figures: readonly string[]): string {
  const shown = figures.slice(0, 3).map(f => `« ${f} »`);
  const more =
    figures.length > 3 ? ` (et ${figures.length - 3} autre${figures.length > 4 ? 's' : ''})` : '';
  const list =
    shown.length > 1
      ? `${shown.slice(0, -1).join(', ')} et ${shown.at(-1) ?? ''}`
      : (shown[0] ?? '');
  const verb = figures.length > 1 ? 'ne figurent pas' : 'ne figure pas';
  return `(Vérification : ${list}${more} ${verb} dans les sources consultées, à vérifier.)`;
}
