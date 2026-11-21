import { createHash } from 'node:crypto';
import type { Brief } from '../brief/briefSchema';
import { cutAtSentence } from '../newsText';

// Cartes du « Fil » : ce que la PWA catdesk-fil fait défiler sur le téléphone.
// Elles sont tirées des rapports que les workflows produisent déjà (brief IA,
// veille GitHub) : aucun appel de LLM en plus. Les bornes reprennent celles de
// la table `fil_cards` (supabase/migrations/20261108000000_fil.sql) : une carte
// normalisée ici passe toujours la validation de `fil_publish`. Pur.

export const FIL_KINDS = ['github', 'version', 'news', 'tendance', 'breve'] as const;
export type FilKind = (typeof FIL_KINDS)[number];

export interface FilLink {
  label: string;
  url: string;
}

export interface FilCard {
  id: string;
  kind: FilKind;
  /** Jour du rapport, AAAA-MM-JJ (Paris). */
  day: string;
  /** Ordre dans le jour, croissant. */
  rank: number;
  title: string;
  summary: string;
  why: string | null;
  verdict: 'a_faire' | 'a_garder' | null;
  details: string | null;
  url: string | null;
  source: string | null;
  links: FilLink[];
}

/** Bornes de la table `fil_cards`. */
export const FIL_LIMITS = {
  title: 200,
  summary: 600,
  why: 400,
  details: 6000,
  source: 120,
  linkLabel: 120,
  links: 4,
} as const;

/** Résumé d'une carte : de quoi lire d'un coup d'œil, le reste est au détail. */
const SUMMARY_TARGET = 280;

/** Identifiant stable : republier le même rapport n'ajoute aucune carte. */
export function cardId(kind: FilKind, url: string | null, title: string): string {
  return createHash('sha1')
    .update(`${kind}\n${url ?? ''}\n${title}`)
    .digest('hex');
}

/** L'URL si elle est en https et bien formée, sinon null (la base refuse le reste). */
export function httpsOrNull(url: string | null | undefined): string | null {
  const trimmed = url?.trim() ?? '';
  if (!/^https:\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function clip(text: string | null | undefined, max: number): string | null {
  const t = text?.trim() ?? '';
  return t === '' ? null : cutAtSentence(t, max);
}

/** Jour de Paris d'un instant, AAAA-MM-JJ. */
export function parisDay(now: Date): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
}

export type FilCardInput = Omit<
  FilCard,
  'id' | 'links' | 'why' | 'verdict' | 'details' | 'url' | 'source'
> & {
  why?: string | null;
  verdict?: FilCard['verdict'];
  details?: string | null;
  url?: string | null;
  source?: string | null;
  links?: readonly FilLink[];
};

/** Carte normalisée : longueurs bornées, liens https seulement, id calculé. Pur. */
export function makeCard(input: FilCardInput): FilCard {
  const title = clip(input.title, FIL_LIMITS.title) ?? '(sans titre)';
  const url = httpsOrNull(input.url);
  const links = (input.links ?? [])
    .flatMap(l => {
      const href = httpsOrNull(l.url);
      const label = clip(l.label, FIL_LIMITS.linkLabel);
      return href !== null && label !== null ? [{ label, url: href }] : [];
    })
    .slice(0, FIL_LIMITS.links);
  return {
    id: cardId(input.kind, url, title),
    kind: input.kind,
    day: input.day,
    rank: input.rank,
    title,
    summary: clip(input.summary, FIL_LIMITS.summary) ?? title,
    why: clip(input.why, FIL_LIMITS.why),
    verdict: input.verdict ?? null,
    details: clip(input.details, FIL_LIMITS.details),
    url,
    source: clip(input.source, FIL_LIMITS.source),
    links,
  };
}

/** Premier paragraphe, sans le gras Markdown : le résumé est du texte simple. */
export function leadParagraph(text: string): string {
  const first = text.split(/\n\s*\n/).find(p => p.trim() !== '') ?? '';
  return cutAtSentence(first.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim(), SUMMARY_TARGET);
}

type BriefSource = Brief['leads'][number]['sources'][number];

function sourceLinks(sources: readonly BriefSource[]): FilLink[] {
  return sources.map(s => ({
    label: s.kind === 'primaire' ? `${s.name} (source primaire)` : s.name,
    url: s.url,
  }));
}

/** Première source en https : le lien principal de la carte. */
function mainSource(sources: readonly BriefSource[]): BriefSource | undefined {
  return sources.find(s => httpsOrNull(s.url) !== null);
}

/**
 * Brief IA → cartes : un sujet « À la une » donne une carte `news` (faits,
 * contexte et points non confirmés au détail), une tendance une carte
 * `tendance`, une brève une carte `breve`. L'agenda reste dans le mail. Pur.
 */
export function briefToCards(brief: Brief, day: string): FilCard[] {
  const cards: FilCard[] = [];
  const push = (input: Omit<FilCardInput, 'day' | 'rank'>) =>
    cards.push(makeCard({ ...input, day, rank: cards.length }));

  for (const lead of brief.leads) {
    const main = mainSource(lead.sources);
    const details = [
      lead.facts,
      `**Contexte**\n\n${lead.context}`,
      ...(lead.uncertain ? [`**Pas confirmé** : ${lead.uncertain}`] : []),
    ].join('\n\n');
    push({
      kind: 'news',
      title: lead.title,
      summary: leadParagraph(lead.facts),
      details,
      url: main?.url ?? null,
      source: main?.name ?? null,
      links: sourceLinks(lead.sources),
    });
  }

  for (const trend of brief.trends) {
    const main = mainSource(trend.sources);
    push({
      kind: 'tendance',
      title: trend.title,
      summary: leadParagraph(trend.body),
      details: trend.body,
      url: main?.url ?? null,
      source: `${trend.kind}${main ? ` · ${main.name}` : ''}`,
      links: sourceLinks(trend.sources),
    });
  }

  for (const section of brief.sections) {
    for (const item of section.items) {
      push({
        kind: 'breve',
        title: item.title,
        summary: item.summary,
        url: item.url,
        source: `${section.name} · ${item.source}`,
      });
    }
  }

  return cards;
}
