import { escapeHtml } from '../dailyEmail';
import { cutAtSentence } from '../newsText';
import { VERDICTS, type VeillePiste, type VeilleReport } from './veilleSchema';

// Mise en page du rapport de veille. Deux lectures, deux formats :
//   - le mail (HTML + texte) est court : de quoi décider, rien de plus ;
//   - l'archive (Markdown) garde tout : elle est relue quand on développe une
//     piste, et la collecte du lendemain y relit les pistes déjà proposées.
// Pur. Les liens sont construits ici à partir du nom du dépôt, jamais repris du
// texte de Claude.

export interface RenderVeilleInput {
  report: VeilleReport;
  now: Date;
  /** Nombre de dépôts examinés, pour le pied de page. */
  candidateCount: number;
  /** Licence SPDX de chaque dépôt collecté (null : non déclarée), lue par le code. */
  licenses: ReadonlyMap<string, string | null>;
}

const VERDICT_EMOJI: Record<VeillePiste['verdict'], string> = {
  a_faire: '🟢',
  a_garder: '🟡',
};

const VERDICT_LABEL: Record<VeillePiste['verdict'], string> = {
  a_faire: '🟢 À faire ensemble',
  a_garder: '🟡 À garder',
};

const INTEGRATION_LABEL: Record<VeillePiste['integration'], string> = {
  skill: 'Skill',
  mcp: 'Serveur MCP',
  outil: 'Outil',
  sidecar: 'Sidecar Python',
  idee: 'Idée à reprendre',
};

const EFFORT_LABEL: Record<VeillePiste['effort'], string> = {
  S: 'une soirée',
  M: 'quelques jours',
  L: 'un chantier',
};

const SUBJECT_MAX = 110;
/** Un écarté tient sur une ligne dans le mail ; la raison entière reste archivée. */
const REJECTED_MAX = 140;

const C = {
  ink: '#18181b',
  muted: '#52525b',
  faint: '#a1a1aa',
  accent: '#4338ca',
  line: '#e4e4e7',
  page: '#f4f4f5',
  card: '#ffffff',
};
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function repoUrl(repo: string): string {
  return `https://github.com/${repo}`;
}

function dateFr(now: Date): string {
  return now.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Paris',
  });
}

/** « 7/11 » : ce que le lecteur tape pour désigner un rapport. */
function shortDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'numeric',
    timeZone: 'Europe/Paris',
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return `${part('day')}/${part('month')}`;
}

function licenseLabel(licenses: RenderVeilleInput['licenses'], repo: string): string {
  return licenses.get(repo) ?? 'licence inconnue';
}

/** « 1. 🟢 À faire ensemble · une soirée · MIT » */
function pisteHead(input: RenderVeilleInput, p: VeillePiste, index: number): string {
  return `${index + 1}. ${VERDICT_LABEL[p.verdict]} · ${EFFORT_LABEL[p.effort]} · ${licenseLabel(input.licenses, p.repo)}`;
}

function pisteWhy(p: VeillePiste): string {
  return `Pourquoi ${VERDICT_EMOJI[p.verdict]} : ${p.why}`;
}

function handoff(now: Date): string {
  return (
    `Pour en développer une, dis-moi : « veille du ${shortDate(now)}, piste 1 ». ` +
    `Le détail de chaque piste (où ça se branche, mesure, risques) est gardé dans l'archive.`
  );
}

function footer(candidateCount: number): string {
  return (
    `Résumé par Claude à partir de ${candidateCount} dépôts publics, collectés sans IA. ` +
    `Avant d'installer quoi que ce soit, relis le dépôt : le rapport se fonde sur ses README.`
  );
}

/** Objet du mail : il porte le fait du jour. Pur. */
export function veilleSubject(report: VeilleReport): string {
  const subject = `Veille CatDesk : ${report.headline}`;
  return subject.length <= SUBJECT_MAX ? subject : `${subject.slice(0, SUBJECT_MAX - 1)}…`;
}

// ─── Mail HTML : court ──────────────────────────────────────────────────────

function repoLink(repo: string): string {
  return `<a href="${escapeHtml(repoUrl(repo))}" style="color:${C.accent}">${escapeHtml(repo)}</a>`;
}

function pisteHtml(input: RenderVeilleInput, p: VeillePiste, index: number): string {
  return (
    `<tr><td style="padding:14px 16px;background:${C.card};border:1px solid ${C.line};border-radius:8px">` +
    `<p style="margin:0 0 2px;font-size:13px;font-weight:600">${escapeHtml(pisteHead(input, p, index))}</p>` +
    `<h2 style="margin:0 0 2px;font-size:17px;line-height:1.3;color:${C.ink}">${escapeHtml(p.title)}</h2>` +
    `<p style="margin:0 0 8px;font-size:13px;color:${C.muted}">${repoLink(p.repo)} · ${escapeHtml(INTEGRATION_LABEL[p.integration])}</p>` +
    `<p style="margin:0 0 6px">${escapeHtml(p.gain)}</p>` +
    `<p style="margin:0;font-size:14px;color:${C.muted}">${escapeHtml(pisteWhy(p))}</p>` +
    `</td></tr><tr><td style="height:10px"></td></tr>`
  );
}

function listHtml(title: string, items: string[]): string {
  if (items.length === 0) return '';
  const lines = items.map(i => `<li style="margin:0 0 6px">${i}</li>`).join('');
  return (
    `<tr><td style="padding:8px 2px 12px">` +
    `<h3 style="margin:0 0 8px;font-size:15px;color:${C.ink}">${escapeHtml(title)}</h3>` +
    `<ul style="margin:0;padding-left:20px;font-size:14px">${lines}</ul></td></tr>`
  );
}

function smallHtml(text: string): string {
  return `<tr><td style="padding:8px 2px 0;font-size:12px;line-height:1.5;color:${C.muted}">${escapeHtml(text)}</td></tr>`;
}

/** HTML du mail : de quoi décider, le détail est archivé. Pur, exporté pour tests. */
export function renderVeilleHtml(input: RenderVeilleInput): string {
  const { report, now, candidateCount } = input;
  const rows = [
    `<tr><td style="padding:4px 2px 12px">` +
      `<p style="margin:0;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.accent}">Veille CatDesk · ${escapeHtml(dateFr(now))}</p>` +
      `</td></tr>`,
    `<tr><td style="padding:0 2px 16px">${escapeHtml(report.summary)}</td></tr>`,
    ...report.pistes.map((p, i) => pisteHtml(input, p, i)),
    listHtml(
      'Nouvelles versions',
      report.releases.map(
        r => `${repoLink(r.repo)} ${escapeHtml(r.version)} : ${escapeHtml(r.impact)}`,
      ),
    ),
    listHtml(
      'Écartés',
      report.rejected.map(
        r => `${repoLink(r.repo)} : ${escapeHtml(cutAtSentence(r.reason, REJECTED_MAX))}`,
      ),
    ),
    report.pistes.length > 0 ? smallHtml(handoff(now)) : '',
    `<tr><td style="padding:8px 2px 0;font-size:11px;line-height:1.5;color:${C.faint}">${escapeHtml(footer(candidateCount))}</td></tr>`,
  ];
  return (
    `<!doctype html><html lang="fr"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(report.headline)}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.page}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.ink}">` +
    rows.join('') +
    `</table></td></tr></table></body></html>`
  );
}

// ─── Mail texte : la même version courte ────────────────────────────────────

/** Partie texte du mail, aussi courte que le HTML. Pur, exporté pour tests. */
export function renderVeilleText(input: RenderVeilleInput): string {
  const { report, now, candidateCount } = input;
  const out = [`Veille CatDesk, ${dateFr(now)}`, '', report.headline, '', report.summary, ''];
  report.pistes.forEach((p, i) => {
    out.push(
      pisteHead(input, p, i),
      p.title,
      `${repoUrl(p.repo)} · ${INTEGRATION_LABEL[p.integration]}`,
      p.gain,
      pisteWhy(p),
      '',
    );
  });
  if (report.releases.length > 0) {
    out.push('Nouvelles versions');
    out.push(...report.releases.map(r => `- ${r.repo} ${r.version} : ${r.impact}`));
    out.push('');
  }
  if (report.rejected.length > 0) {
    out.push('Écartés');
    out.push(...report.rejected.map(r => `- ${r.repo} : ${cutAtSentence(r.reason, REJECTED_MAX)}`));
    out.push('');
  }
  if (report.pistes.length > 0) out.push(handoff(now), '');
  out.push(footer(candidateCount), '');
  return out.join('\n');
}

// ─── Archive Markdown : complète ────────────────────────────────────────────

function pisteHeading(p: VeillePiste, index: number): string {
  return `## Piste ${index + 1} · ${VERDICT_LABEL[p.verdict]} : ${p.title}`;
}

function pisteMarkdown(input: RenderVeilleInput, p: VeillePiste, index: number): string[] {
  const meta = [
    `[${p.repo}](${repoUrl(p.repo)})`,
    INTEGRATION_LABEL[p.integration],
    p.domain,
    EFFORT_LABEL[p.effort],
    licenseLabel(input.licenses, p.repo),
  ].join(' · ');
  return [
    pisteHeading(p, index),
    '',
    meta,
    '',
    `- **Pourquoi ce verdict** : ${p.why}`,
    `- **Ce que CatDesk gagne** : ${p.gain}`,
    `- **Où ça se branche** : ${p.how}`,
    `- **Licence** : ${p.license}`,
    `- **Comment le mesurer** : ${p.measure}`,
    `- **Risques** : ${p.risks}`,
    '',
  ];
}

/** Markdown complet du rapport, pour l'archive. Pur, exporté pour tests. */
export function renderVeilleMarkdown(input: RenderVeilleInput): string {
  const { report, now, candidateCount } = input;
  const out = [`# Veille CatDesk, ${dateFr(now)}`, '', report.headline, '', report.summary, ''];
  if (report.pistes.length > 1) {
    out.push(...report.pistes.map((p, i) => `${i + 1}. ${VERDICT_LABEL[p.verdict]} : ${p.title}`));
    out.push('');
  }
  out.push(...report.pistes.flatMap((p, i) => pisteMarkdown(input, p, i)));
  if (report.releases.length > 0) {
    out.push('## Nouvelles versions', '');
    out.push(
      ...report.releases.map(r => `- [${r.repo}](${repoUrl(r.repo)}) ${r.version} : ${r.impact}`),
    );
    out.push('');
  }
  if (report.rejected.length > 0) {
    out.push('## Écartés', '');
    out.push(...report.rejected.map(r => `- [${r.repo}](${repoUrl(r.repo)}) : ${r.reason}`));
    out.push('');
  }
  out.push(footer(candidateCount), '');
  return out.join('\n');
}

// ─── Relecture de l'archive : la mémoire des idées ──────────────────────────

export type ParsedPiste = Pick<VeillePiste, 'verdict' | 'title' | 'repo'>;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const HEADING = new RegExp(
  `^## (?:Piste \\d+ · )?(${VERDICTS.map(v => escapeRegExp(VERDICT_LABEL[v])).join('|')}) : (.+)$`,
);
const REPO_LINE = /^\[([\w.-]+\/[\w.-]+)\]\(/;

/**
 * Relit les pistes d'un rapport archivé par `renderVeilleMarkdown`, dans le
 * format actuel comme dans le premier (titres sans numéro, 6 et 7/11/2026).
 * Une piste dont la ligne du dépôt manque est ignorée. Pur, exporté pour tests.
 */
export function parsePastPistes(markdown: string): ParsedPiste[] {
  const lines = markdown.split(/\r?\n/);
  const verdictOf = new Map(VERDICTS.map(v => [VERDICT_LABEL[v], v]));
  const out: ParsedPiste[] = [];
  lines.forEach((line, i) => {
    const heading = HEADING.exec(line);
    if (!heading) return;
    const next = lines.slice(i + 1).find(l => l.trim() !== '') ?? '';
    const repo = REPO_LINE.exec(next)?.[1];
    const verdict = verdictOf.get(heading[1]!);
    if (repo === undefined || verdict === undefined) return;
    out.push({ verdict, title: heading[2]!.trim(), repo });
  });
  return out;
}
