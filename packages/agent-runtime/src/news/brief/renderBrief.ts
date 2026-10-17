import { escapeHtml, inlineHtml } from '../dailyEmail';
import { cutAtSentence } from '../newsText';
import { BRIEF_SECTIONS, type Brief } from './briefSchema';

// Mise en page du brief quotidien en e-mail : HTML à styles en ligne et
// tableaux (Outlook ignore les max-width et une partie du CSS), plus une
// version texte. Pur : les images arrivent déjà résolues (voir briefAssets).

/** Visuels résolus d'un sujet « À la une » : identifiants d'images, ou null. */
export interface LeadVisuals {
  image: string | null;
  diagram: string | null;
  /** Schéma vertical : affiché plus étroit et centré, sinon il remplirait l'écran. */
  diagramVertical?: boolean;
}

export interface RenderBriefInput {
  brief: Brief;
  /** Un élément par sujet « À la une », dans l'ordre de `brief.leads`. */
  visuals: LeadVisuals[];
  /** Identifiant d'image → valeur de `src` (« cid:… » pour le mail, data: pour l'aperçu). */
  imageSrc: (id: string) => string;
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
  actionSoft: '#ecfdf5',
};
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

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

function block(title: string, inner: string, bg = '#ffffff', border = C.line): string {
  return (
    `<tr><td style="padding:0 0 16px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border:1px solid ${border};border-radius:10px">` +
    `<tr><td style="padding:20px 22px">` +
    (title
      ? `<p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${C.muted}">${escapeHtml(title)}</p>`
      : '') +
    inner +
    `</td></tr></table></td></tr>`
  );
}

function bullets(items: string[], max: number, ordered = false): string {
  const tag = ordered ? 'ol' : 'ul';
  const lis = items
    .map(s => trim(s, max))
    .filter(s => s.length > 0)
    .map(s => `<li style="margin:0 0 8px">${inlineHtml(s)}</li>`)
    .join('');
  return `<${tag} style="margin:0;padding-left:20px">${lis}</${tag}>`;
}

function leadHtml(
  lead: Brief['leads'][number],
  visuals: LeadVisuals,
  imageSrc: (id: string) => string,
): string {
  const parts: string[] = [];
  if (visuals.image !== null) {
    parts.push(
      `<img src="${escapeHtml(imageSrc(visuals.image))}" alt="" width="594" style="display:block;width:100%;max-width:594px;height:auto;border-radius:8px;margin:0 0 14px">`,
    );
  }
  parts.push(
    `<h2 style="margin:0 0 10px;font-size:19px;line-height:1.3;color:${C.ink}">${escapeHtml(trim(lead.title, 160))}</h2>`,
    `<p style="margin:0 0 12px">${inlineHtml(trim(lead.summary, 1800))}</p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px"><tr>` +
      `<td style="border-left:3px solid ${C.accent};background:${C.accentSoft};padding:10px 14px;border-radius:0 6px 6px 0">` +
      `<p style="margin:0 0 4px;font-size:12px;font-weight:700;color:${C.accent}">Ce que ça change</p>` +
      `<p style="margin:0">${inlineHtml(trim(lead.whyItMatters, 1200))}</p></td></tr></table>`,
  );
  if (visuals.diagram !== null && lead.diagram !== null) {
    const width = visuals.diagramVertical === true ? 380 : 594;
    parts.push(
      `<img src="${escapeHtml(imageSrc(visuals.diagram))}" alt="${escapeHtml(lead.diagram.caption)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;margin:0 auto;border:1px solid ${C.line};border-radius:6px">`,
      `<p style="margin:6px 0 12px;font-size:12px;color:${C.muted};font-style:italic">${escapeHtml(trim(lead.diagram.caption, 200))}</p>`,
    );
  }
  const sources = lead.sources
    .slice(0, 3)
    .map(s => link(s.name, s.url))
    .join(' · ');
  parts.push(`<p style="margin:0;font-size:12px;color:${C.muted}">Sources : ${sources}</p>`);
  return block('', parts.join(''));
}

function sectionsHtml(brief: Brief): string {
  // Ordre canonique des rubriques, quel que soit l'ordre rendu par le modèle.
  const ordered = BRIEF_SECTIONS.map(name => brief.sections.find(s => s.name === name)).filter(
    (s): s is Brief['sections'][number] => s !== undefined && s.items.length > 0,
  );
  if (ordered.length === 0) return '';
  const inner = ordered
    .map(
      s =>
        `<h3 style="margin:16px 0 8px;font-size:15px;color:${C.ink}">${escapeHtml(s.name)}</h3>` +
        s.items
          .slice(0, 5)
          .map(
            it =>
              `<p style="margin:0 0 10px">${link(trim(it.title, 160), it.url, `color:${C.ink};font-weight:600;text-decoration:none`)}` +
              ` — ${inlineHtml(trim(it.summary, 900))} <span style="color:${C.faint};font-size:12px">${escapeHtml(it.source)}</span></p>`,
          )
          .join(''),
    )
    .join('')
    .replace(/^<h3 style="margin:16px/, '<h3 style="margin:0');
  return block('En bref', inner);
}

/** HTML complet du brief. Pur, exporté pour tests. */
export function renderBriefHtml(input: RenderBriefInput): string {
  const { brief, visuals, imageSrc, since, now } = input;
  const rows: string[] = [];

  rows.push(
    `<tr><td style="padding:4px 2px 18px">` +
      `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.accent}">Veille IA · ${escapeHtml(dateFr(now, { weekday: 'long', day: 'numeric', month: 'long' }))}</p>` +
      `<h1 style="margin:0;font-size:24px;line-height:1.25;color:${C.ink}">${escapeHtml(trim(brief.headline, 140))}</h1>` +
      `</td></tr>`,
  );
  rows.push(
    block('L’essentiel en 30 secondes', bullets(brief.essentials, 600), C.accentSoft, '#c7d2fe'),
  );
  rows.push(
    `<tr><td style="padding:6px 2px 10px"><p style="margin:0;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${C.muted}">À la une</p></td></tr>`,
  );
  brief.leads.slice(0, 3).forEach((lead, i) => {
    rows.push(leadHtml(lead, visuals[i] ?? { image: null, diagram: null }, imageSrc));
  });
  rows.push(sectionsHtml(brief));
  rows.push(
    block('Pour le référent IA', bullets(brief.forTheLead, 900, true), C.actionSoft, '#a7f3d0'),
  );
  if (brief.toWatch.length > 0) rows.push(block('À surveiller', bullets(brief.toWatch, 600)));

  const period = `du ${dateFr(since, { day: 'numeric', month: 'long' })} au ${dateFr(now, { day: 'numeric', month: 'long' })}`;
  rows.push(
    `<tr><td style="padding:8px 2px 0;font-size:11px;line-height:1.5;color:${C.faint}">` +
      `Rédigé par Claude (Anthropic) à partir de ${input.candidateCount} articles de sources publiques, ${escapeHtml(period)}. ` +
      `Les synthèses sont générées par IA : vérifie dans l’article d’origine avant de citer.</td></tr>`,
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
export function renderBriefText(input: Omit<RenderBriefInput, 'visuals' | 'imageSrc'>): string {
  const { brief } = input;
  const out: string[] = [brief.headline, ''];
  out.push('L’ESSENTIEL', ...brief.essentials.map(s => `- ${s}`), '');
  out.push('À LA UNE');
  for (const lead of brief.leads.slice(0, 3)) {
    out.push(
      '',
      lead.title,
      lead.summary,
      `Ce que ça change : ${lead.whyItMatters}`,
      `Sources : ${lead.sources.map(s => `${s.name} <${s.url}>`).join(' · ')}`,
    );
  }
  for (const name of BRIEF_SECTIONS) {
    const section = brief.sections.find(s => s.name === name);
    if (section === undefined || section.items.length === 0) continue;
    out.push(
      '',
      name.toUpperCase(),
      ...section.items.map(it => `- ${it.title} — ${it.summary} <${it.url}>`),
    );
  }
  out.push('', 'POUR LE RÉFÉRENT IA', ...brief.forTheLead.map((s, i) => `${i + 1}. ${s}`));
  if (brief.toWatch.length > 0) out.push('', 'À SURVEILLER', ...brief.toWatch.map(s => `- ${s}`));
  out.push(
    '',
    '--',
    'Rédigé par Claude (Anthropic) à partir de sources publiques. Vérifie avant de citer.',
  );
  return out.join('\n');
}
