import { escapeHtml, inlineHtml } from '../dailyEmail';
import { cutAtSentence } from '../newsText';
import { BRIEF_SECTIONS, TREND_KINDS, type Brief } from './briefSchema';

// Mise en page du brief quotidien en e-mail : HTML à styles en ligne et
// tableaux (Outlook ignore les max-width et une partie du CSS), plus une
// version texte. Pur. Aucun visuel (choix du lecteur, 2026-10-21) : le texte
// porte l'information, un sommaire cliquable permet d'aller droit au sujet.
//
// Le corps ne répète pas l'objet du mail : il s'ouvre sur la date et le
// sommaire — « un fait, une place » (voir briefSchema).

export interface RenderBriefInput {
  brief: Brief;
  since: Date;
  now: Date;
  /** Nombre d'articles candidats lus, pour le pied de page. */
  candidateCount: number;
}

/** Plafonds d'affichage : filets contre une sortie démesurée, au-dessus de ce que demande le schéma. */
const MAX_LEADS = 6;
const MAX_TRENDS = 8;
const MAX_BRIEFS = 6;
const MAX_AGENDA = 6;

const C = {
  ink: '#18181b',
  muted: '#52525b',
  faint: '#a1a1aa',
  line: '#e4e4e7',
  page: '#f4f4f5',
  soft: '#fafafa',
  accent: '#4338ca',
  accentSoft: '#eef2ff',
  warn: '#b45309',
};
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const LABEL = `margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase`;

/**
 * Coupe à la phrase un texte trop long : filet de sécurité contre une sortie
 * démesurée, pas un outil de style — la longueur est demandée dans le schéma.
 * Plafonds larges, pour ne jamais tronquer une phrase normale.
 */
function trim(text: string, max: number): string {
  return cutAtSentence(text.trim(), max);
}

/** Paragraphes séparés par une ligne vide → `<p>` ; un simple saut de ligne devient une espace. */
function paragraphs(text: string, style: string): string {
  return text
    .split(/\n\s*\n/)
    .map(p => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(p => p.length > 0)
    .map(p => `<p style="${style}">${inlineHtml(p)}</p>`)
    .join('');
}

function safeUrl(url: string): string | null {
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

function link(
  label: string,
  url: string,
  style = `color:${C.accent};text-decoration:none`,
): string {
  const href = safeUrl(url);
  return href === null
    ? escapeHtml(label)
    : `<a href="${escapeHtml(href)}" style="${style}">${escapeHtml(label)}</a>`;
}

type SourceRef = Brief['leads'][number]['sources'][number];

function sourcesHtml(sources: SourceRef[], max: number): string {
  const list = sources
    .slice(0, max)
    .map(s => link(s.name, s.url) + (s.kind === 'primaire' ? ' (source primaire)' : ''))
    .join(' · ');
  return `<p style="margin:8px 0 0;font-size:12px;color:${C.muted}">Sources : ${list}</p>`;
}

function sourcesText(sources: SourceRef[]): string {
  return `Sources : ${sources.map(s => `${s.name}${s.kind === 'primaire' ? ' (source primaire)' : ''} <${s.url}>`).join(' · ')}`;
}

function dateFr(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', ...opts });
}

/** Objet du mail : date courte + titre du jour. Pur, exporté pour tests. */
export function briefSubject(brief: Brief, now: Date): string {
  return `Veille IA · ${dateFr(now, { day: 'numeric', month: 'short' })} — ${trim(brief.headline, 110)}`;
}

/** Cible de lien interne : `id` (Gmail, Apple Mail) ET `<a name>` (Outlook/Word). */
function anchor(name: string): string {
  return `<a name="${name}" id="${name}"></a>`;
}

function block(inner: string, title = '', bg = '#ffffff', border = C.line): string {
  return (
    `<tr><td style="padding:0 0 16px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border:1px solid ${border};border-radius:10px">` +
    `<tr><td style="padding:20px 22px">` +
    (title
      ? `<p style="${LABEL};margin-bottom:12px;color:${C.muted}">${escapeHtml(title)}</p>`
      : '') +
    inner +
    `</td></tr></table></td></tr>`
  );
}

function presentSections(brief: Brief): Brief['sections'] {
  // Ordre canonique des rubriques, quel que soit l'ordre rendu par le modèle.
  return BRIEF_SECTIONS.map(name => brief.sections.find(s => s.name === name)).filter(
    (s): s is Brief['sections'][number] => s !== undefined && s.items.length > 0,
  );
}

interface TrendGroup {
  kind: string;
  trends: Brief['trends'];
}

/** Tendances regroupées par nature, dans l'ordre canonique ; natures vides omises. */
function trendGroups(brief: Brief): TrendGroup[] {
  const shown = brief.trends.slice(0, MAX_TRENDS);
  return TREND_KINDS.map(kind => ({ kind, trends: shown.filter(t => t.kind === kind) })).filter(
    g => g.trends.length > 0,
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

interface TocEntry {
  href: string;
  label: string;
}

interface TocGroup {
  title: string;
  /** Lien du titre de groupe, ou null quand ses entrées suffisent. */
  href: string | null;
  entries: TocEntry[];
}

/**
 * Sommaire détaillé, dans l'ordre du corps : tendances (une entrée chacune),
 * sujets « À la une », rubriques des brèves avec leur nombre, agenda.
 */
function tocGroups(brief: Brief, trends: TrendGroup[], sections: Brief['sections']): TocGroup[] {
  const groups: TocGroup[] = [];
  if (trends.length > 0) {
    groups.push({
      title: 'Tendances du secteur',
      href: '#tendances',
      entries: trends
        .flatMap(g => g.trends.map(t => `${g.kind} · ${trim(t.title, 160)}`))
        .map((label, i) => ({ href: `#tendance-${i + 1}`, label })),
    });
  }
  groups.push({
    title: 'À la une',
    href: null,
    entries: brief.leads
      .slice(0, MAX_LEADS)
      .map((lead, i) => ({ href: `#sujet-${i + 1}`, label: trim(lead.title, 160) })),
  });
  if (sections.length > 0) {
    const count = sections.reduce((n, s) => n + Math.min(s.items.length, MAX_BRIEFS), 0);
    groups.push({
      title: `En bref — ${plural(count, 'brève', 'brèves')}`,
      href: '#en-bref',
      entries: sections.map((s, i) => ({
        href: `#bref-${i + 1}`,
        label: `${s.name} (${Math.min(s.items.length, MAX_BRIEFS)})`,
      })),
    });
  }
  if (brief.agenda.length > 0) {
    groups.push({
      title: `Agenda — ${plural(Math.min(brief.agenda.length, MAX_AGENDA), 'échéance', 'échéances')}`,
      href: '#agenda',
      entries: [],
    });
  }
  return groups;
}

function tocHtml(groups: TocGroup[]): string {
  const linkStyle = `color:${C.accent};text-decoration:none`;
  const inner = groups
    .map((g, i) => {
      const title =
        g.href === null
          ? escapeHtml(g.title)
          : `<a href="${g.href}" style="${linkStyle}">${escapeHtml(g.title)}</a>`;
      const items = g.entries
        .map(
          e =>
            `<li style="margin:0 0 4px"><a href="${e.href}" style="${linkStyle}">${escapeHtml(e.label)}</a></li>`,
        )
        .join('');
      return (
        `<p style="margin:${i === 0 ? 0 : 12}px 0 4px;font-weight:700;color:${C.ink}">${title}</p>` +
        (items ? `<ul style="margin:0;padding-left:20px">${items}</ul>` : '')
      );
    })
    .join('');
  return block(inner, 'Au sommaire', C.accentSoft, '#c7d2fe');
}

function leadHtml(lead: Brief['leads'][number], index: number): string {
  const parts: string[] = [
    `<h2 style="margin:0 0 12px;font-size:19px;line-height:1.3;color:${C.ink}">${escapeHtml(trim(lead.title, 160))}</h2>`,
    `<p style="${LABEL};color:${C.muted}">Les faits</p>`,
    paragraphs(trim(lead.facts, 3200), 'margin:0 0 14px'),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:2px 0 12px"><tr>` +
      `<td style="border-left:3px solid ${C.line};background:${C.soft};padding:10px 14px;border-radius:0 6px 6px 0">` +
      `<p style="${LABEL};color:${C.muted}">Le contexte</p>` +
      paragraphs(trim(lead.context, 1600), 'margin:0') +
      `</td></tr></table>`,
  ];
  if (lead.uncertain !== null && lead.uncertain.trim() !== '') {
    parts.push(
      `<p style="margin:0 0 8px"><strong style="color:${C.warn}">À confirmer :</strong> ${inlineHtml(trim(lead.uncertain, 600))}</p>`,
    );
  }
  parts.push(sourcesHtml(lead.sources, 4));
  return `<tr><td>${anchor(`sujet-${index + 1}`)}</td></tr>` + block(parts.join(''));
}

function trendsHtml(groups: TrendGroup[]): string {
  let n = 0;
  const inner = groups
    .map(
      (g, i) =>
        `<h3 style="margin:${i === 0 ? 0 : 18}px 0 10px;font-size:15px;color:${C.accent}">${escapeHtml(g.kind)}</h3>` +
        g.trends
          .map(
            t =>
              anchor(`tendance-${++n}`) +
              `<div style="margin:0 0 16px">` +
              `<p style="margin:0 0 4px;font-weight:600;color:${C.ink}">${escapeHtml(trim(t.title, 160))}</p>` +
              paragraphs(trim(t.body, 1600), 'margin:0 0 8px') +
              sourcesHtml(t.sources, 3) +
              `</div>`,
          )
          .join(''),
    )
    .join('');
  return `<tr><td>${anchor('tendances')}</td></tr>` + block(inner, 'Tendances du secteur');
}

function sectionsHtml(sections: Brief['sections']): string {
  const inner = sections
    .map(
      (s, i) =>
        anchor(`bref-${i + 1}`) +
        `<h3 style="margin:${i === 0 ? 0 : 16}px 0 8px;font-size:15px;color:${C.ink}">${escapeHtml(s.name)}</h3>` +
        s.items
          .slice(0, MAX_BRIEFS)
          .map(
            it =>
              `<p style="margin:0 0 10px">${link(trim(it.title, 160), it.url, `color:${C.ink};font-weight:600;text-decoration:none`)}` +
              ` — ${inlineHtml(trim(it.summary, 700))} <span style="color:${C.faint};font-size:12px">${escapeHtml(it.source)}</span></p>`,
          )
          .join(''),
    )
    .join('');
  return `<tr><td>${anchor('en-bref')}</td></tr>` + block(inner, 'En bref');
}

function agendaHtml(agenda: Brief['agenda']): string {
  const rows = agenda
    .slice(0, MAX_AGENDA)
    .map(
      a =>
        `<tr><td valign="top" style="padding:0 14px 8px 0;white-space:nowrap;font-weight:600;color:${C.ink}">${escapeHtml(trim(a.date, 60))}</td>` +
        `<td valign="top" style="padding:0 0 8px">${inlineHtml(trim(a.event, 400))}</td></tr>`,
    )
    .join('');
  return (
    `<tr><td>${anchor('agenda')}</td></tr>` +
    block(`<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>`, 'Agenda')
  );
}

/** HTML complet du brief. Pur, exporté pour tests. */
export function renderBriefHtml(input: RenderBriefInput): string {
  const { brief, since, now } = input;
  const sections = presentSections(brief);
  const trends = trendGroups(brief);
  const rows: string[] = [
    `<tr><td style="padding:4px 2px 16px">` +
      `<p style="margin:0;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.accent}">Veille IA · ${escapeHtml(dateFr(now, { weekday: 'long', day: 'numeric', month: 'long' }))}</p>` +
      `</td></tr>`,
    tocHtml(tocGroups(brief, trends, sections)),
  ];
  // Les tendances en tête (choix du lecteur, 2026-10-28), puis les sujets.
  if (trends.length > 0) rows.push(trendsHtml(trends));
  rows.push(...brief.leads.slice(0, MAX_LEADS).map((lead, i) => leadHtml(lead, i)));
  if (sections.length > 0) rows.push(sectionsHtml(sections));
  if (brief.agenda.length > 0) rows.push(agendaHtml(brief.agenda));

  const period = `du ${dateFr(since, { day: 'numeric', month: 'long' })} au ${dateFr(now, { day: 'numeric', month: 'long' })}`;
  rows.push(
    `<tr><td style="padding:8px 2px 0;font-size:11px;line-height:1.5;color:${C.faint}">` +
      `Rédigé par Claude (Anthropic) à partir de ${input.candidateCount} articles de sources publiques, ${escapeHtml(period)}, et des sources primaires qu’ils citent. ` +
      `Synthèses générées par IA : vérifie dans la source avant de citer.</td></tr>`,
  );

  return (
    `<!doctype html><html lang="fr"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(brief.headline)}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.page}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.ink}">` +
    rows.join('') +
    `</table></td></tr></table></body></html>`
  );
}

/** Version texte du brief (clients sans HTML, aperçus de notification). Pur. */
export function renderBriefText(input: RenderBriefInput): string {
  const { brief } = input;
  const leads = brief.leads.slice(0, MAX_LEADS);
  const sections = presentSections(brief);
  const trends = trendGroups(brief);
  const out: string[] = ['AU SOMMAIRE'];
  for (const g of tocGroups(brief, trends, sections)) {
    out.push('', g.title, ...g.entries.map(e => `- ${e.label}`));
  }
  if (trends.length > 0) {
    out.push('', 'TENDANCES DU SECTEUR');
    for (const g of trends) {
      out.push('', g.kind);
      for (const t of g.trends) out.push(`- ${t.title} — ${t.body}`, `  ${sourcesText(t.sources)}`);
    }
  }
  out.push('', 'À LA UNE');
  leads.forEach((lead, i) => {
    out.push(
      '',
      `${i + 1}. ${lead.title.toUpperCase()}`,
      lead.facts,
      '',
      `Contexte : ${lead.context}`,
    );
    if (lead.uncertain) out.push(`À confirmer : ${lead.uncertain}`);
    out.push(sourcesText(lead.sources));
  });
  if (sections.length > 0) {
    out.push('', 'EN BREF');
    for (const s of sections) {
      out.push('', s.name, ...s.items.map(it => `- ${it.title} — ${it.summary} <${it.url}>`));
    }
  }
  if (brief.agenda.length > 0) {
    out.push('', 'AGENDA', ...brief.agenda.map(a => `- ${a.date} : ${a.event}`));
  }
  out.push(
    '',
    '--',
    'Rédigé par Claude (Anthropic) à partir de sources publiques. Vérifie avant de citer.',
  );
  return out.join('\n');
}
