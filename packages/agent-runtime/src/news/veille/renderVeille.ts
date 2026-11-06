import { escapeHtml } from '../dailyEmail';
import type { VeillePiste, VeilleReport } from './veilleSchema';

// Mise en page du rapport de veille : HTML à styles en ligne pour le mail, et
// Markdown pour la version texte du mail comme pour l'archive. Pur. Les liens
// sont construits ici à partir du nom du dépôt, jamais repris du texte de Claude.

export interface RenderVeilleInput {
  report: VeilleReport;
  now: Date;
  /** Nombre de dépôts examinés, pour le pied de page. */
  candidateCount: number;
}

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

/** Objet du mail : il porte le fait du jour. Pur. */
export function veilleSubject(report: VeilleReport): string {
  const subject = `Veille CatDesk : ${report.headline}`;
  return subject.length <= SUBJECT_MAX ? subject : `${subject.slice(0, SUBJECT_MAX - 1)}…`;
}

function repoLink(repo: string): string {
  return `<a href="${escapeHtml(repoUrl(repo))}" style="color:${C.accent}">${escapeHtml(repo)}</a>`;
}

function fieldHtml(label: string, value: string): string {
  return (
    `<p style="margin:0 0 8px"><span style="color:${C.muted};font-size:13px">${escapeHtml(label)}</span><br>` +
    `${escapeHtml(value)}</p>`
  );
}

function pisteHtml(p: VeillePiste): string {
  const meta = `${INTEGRATION_LABEL[p.integration]} · ${p.domain} · ${EFFORT_LABEL[p.effort]}`;
  return (
    `<tr><td style="padding:16px 18px;background:${C.card};border:1px solid ${C.line};border-radius:8px">` +
    `<p style="margin:0 0 4px;font-size:13px;font-weight:600">${escapeHtml(VERDICT_LABEL[p.verdict])}</p>` +
    `<h2 style="margin:0 0 4px;font-size:18px;line-height:1.3;color:${C.ink}">${escapeHtml(p.title)}</h2>` +
    `<p style="margin:0 0 12px;font-size:13px;color:${C.muted}">${repoLink(p.repo)} · ${escapeHtml(meta)}</p>` +
    fieldHtml('Ce que CatDesk gagne', p.gain) +
    fieldHtml('Où ça se branche', p.how) +
    fieldHtml('Licence', p.license) +
    fieldHtml('Comment le mesurer', p.measure) +
    fieldHtml('Risques', p.risks) +
    `</td></tr><tr><td style="height:12px"></td></tr>`
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

function footer(candidateCount: number): string {
  return (
    `Résumé par Claude à partir de ${candidateCount} dépôts publics, collectés sans IA. ` +
    `Avant d'installer quoi que ce soit, relis le dépôt : le rapport se fonde sur ses README.`
  );
}

/** HTML complet du rapport. Pur, exporté pour tests. */
export function renderVeilleHtml(input: RenderVeilleInput): string {
  const { report, now, candidateCount } = input;
  const rows = [
    `<tr><td style="padding:4px 2px 12px">` +
      `<p style="margin:0;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.accent}">Veille CatDesk · ${escapeHtml(dateFr(now))}</p>` +
      `</td></tr>`,
    `<tr><td style="padding:0 2px 16px">${escapeHtml(report.summary)}</td></tr>`,
    ...report.pistes.map(pisteHtml),
    listHtml(
      'Nouvelles versions',
      report.releases.map(
        r => `${repoLink(r.repo)} ${escapeHtml(r.version)} : ${escapeHtml(r.impact)}`,
      ),
    ),
    listHtml(
      'Écartés',
      report.rejected.map(r => `${repoLink(r.repo)} : ${escapeHtml(r.reason)}`),
    ),
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

function pisteMarkdown(p: VeillePiste): string[] {
  return [
    `## ${VERDICT_LABEL[p.verdict]} : ${p.title}`,
    '',
    `[${p.repo}](${repoUrl(p.repo)}) · ${INTEGRATION_LABEL[p.integration]} · ${p.domain} · ${EFFORT_LABEL[p.effort]}`,
    '',
    `- **Ce que CatDesk gagne** : ${p.gain}`,
    `- **Où ça se branche** : ${p.how}`,
    `- **Licence** : ${p.license}`,
    `- **Comment le mesurer** : ${p.measure}`,
    `- **Risques** : ${p.risks}`,
    '',
  ];
}

/** Markdown du rapport : version texte du mail et archive. Pur, exporté pour tests. */
export function renderVeilleMarkdown(input: RenderVeilleInput): string {
  const { report, now, candidateCount } = input;
  const out = [`# Veille CatDesk, ${dateFr(now)}`, '', report.headline, '', report.summary, ''];
  out.push(...report.pistes.flatMap(pisteMarkdown));
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
