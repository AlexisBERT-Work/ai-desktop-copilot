import { escapeHtml, inlineHtml } from '../dailyEmail';
import { cutAtSentence } from '../newsText';
import { BRIEF_SECTIONS, type Brief } from './briefSchema';

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

const C = {
  ink: '#18181b',
  muted: '#52525b',
  faint: '#a1a1aa',
  line: '#e4e4e7',
  page: '#f4f4f5',
  accent: '#4338ca',
  accentSoft: '#eef2ff',
  action: '#047857',
  warn: '#b45309',
};
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const LABEL = `margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase`;

/**
 * Coupe à la phrase un texte trop long : filet de sécurité contre une sortie
 * démesurée, pas un outil de style — la concision est demandée dans le schéma.
 * Plafonds larges, pour ne jamais tronquer une phrase normale.
 */
function trim(text: string, max: number): string {
  return cutAtSentence(text.trim(), max);
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

function tocHtml(brief: Brief, hasBriefs: boolean): string {
  const entries = brief.leads
    .slice(0, 3)
    .map((lead, i) => ({ href: `#sujet-${i + 1}`, label: trim(lead.title, 160) }));
  if (hasBriefs) entries.push({ href: '#en-bref', label: 'En bref' });
  if (brief.agenda.length > 0) entries.push({ href: '#agenda', label: 'Agenda' });
  const items = entries
    .map(
      e =>
        `<li style="margin:0 0 6px"><a href="${e.href}" style="color:${C.accent};text-decoration:none">${escapeHtml(e.label)}</a></li>`,
    )
    .join('');
  return block(
    `<ol style="margin:0;padding-left:20px">${items}</ol>`,
    'Au sommaire',
    C.accentSoft,
    '#c7d2fe',
  );
}

function leadHtml(lead: Brief['leads'][number], index: number): string {
  const parts: string[] = [
    `<h2 style="margin:0 0 12px;font-size:19px;line-height:1.3;color:${C.ink}">${escapeHtml(trim(lead.title, 160))}</h2>`,
    `<p style="${LABEL};color:${C.muted}">Les faits</p>`,
    `<p style="margin:0 0 14px">${inlineHtml(trim(lead.facts, 1800))}</p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px"><tr>` +
      `<td style="border-left:3px solid ${C.accent};background:${C.accentSoft};padding:10px 14px;border-radius:0 6px 6px 0">` +
      `<p style="${LABEL};color:${C.accent}">Pour nous</p>` +
      `<p style="margin:0">${inlineHtml(trim(lead.forUs, 1200))}</p></td></tr></table>`,
  ];
  if (lead.action !== null && lead.action.trim() !== '') {
    parts.push(
      `<p style="margin:0 0 8px"><strong style="color:${C.action}">Action :</strong> ${inlineHtml(trim(lead.action, 600))}</p>`,
    );
  }
  if (lead.uncertain !== null && lead.uncertain.trim() !== '') {
    parts.push(
      `<p style="margin:0 0 8px"><strong style="color:${C.warn}">À confirmer :</strong> ${inlineHtml(trim(lead.uncertain, 600))}</p>`,
    );
  }
  const sources = lead.sources
    .slice(0, 3)
    .map(s => link(s.name, s.url) + (s.kind === 'primaire' ? ' (source primaire)' : ''))
    .join(' · ');
  parts.push(`<p style="margin:10px 0 0;font-size:12px;color:${C.muted}">Sources : ${sources}</p>`);
  return `<tr><td>${anchor(`sujet-${index + 1}`)}</td></tr>` + block(parts.join(''));
}

function sectionsHtml(sections: Brief['sections']): string {
  const inner = sections
    .map(
      (s, i) =>
        `<h3 style="margin:${i === 0 ? 0 : 16}px 0 8px;font-size:15px;color:${C.ink}">${escapeHtml(s.name)}</h3>` +
        s.items
          .slice(0, 5)
          .map(
            it =>
              `<p style="margin:0 0 10px">${link(trim(it.title, 160), it.url, `color:${C.ink};font-weight:600;text-decoration:none`)}` +
              ` — ${inlineHtml(trim(it.summary, 600))} <span style="color:${C.faint};font-size:12px">${escapeHtml(it.source)}</span></p>`,
          )
          .join(''),
    )
    .join('');
  return `<tr><td>${anchor('en-bref')}</td></tr>` + block(inner, 'En bref');
}

function agendaHtml(agenda: Brief['agenda']): string {
  const rows = agenda
    .slice(0, 6)
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
  const rows: string[] = [
    `<tr><td style="padding:4px 2px 16px">` +
      `<p style="margin:0;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.accent}">Veille IA · ${escapeHtml(dateFr(now, { weekday: 'long', day: 'numeric', month: 'long' }))}</p>` +
      `</td></tr>`,
    tocHtml(brief, sections.length > 0),
    ...brief.leads.slice(0, 3).map((lead, i) => leadHtml(lead, i)),
  ];
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
    `<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;font-family:${FONT};font-size:15px;line-height:1.55;color:${C.ink}">` +
    rows.join('') +
    `</table></td></tr></table></body></html>`
  );
}

/** Version texte du brief (clients sans HTML, aperçus de notification). Pur. */
export function renderBriefText(input: RenderBriefInput): string {
  const { brief } = input;
  const sections = presentSections(brief);
  const out: string[] = [
    'AU SOMMAIRE',
    ...brief.leads.slice(0, 3).map((l, i) => `${i + 1}. ${l.title}`),
  ];
  brief.leads.slice(0, 3).forEach((lead, i) => {
    out.push('', `${i + 1}. ${lead.title.toUpperCase()}`, lead.facts, `Pour nous : ${lead.forUs}`);
    if (lead.action) out.push(`Action : ${lead.action}`);
    if (lead.uncertain) out.push(`À confirmer : ${lead.uncertain}`);
    out.push(
      `Sources : ${lead.sources.map(s => `${s.name}${s.kind === 'primaire' ? ' (source primaire)' : ''} <${s.url}>`).join(' · ')}`,
    );
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
