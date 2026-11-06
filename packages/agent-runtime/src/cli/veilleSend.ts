// Veille GitHub, étape 3/3 : valide le rapport rédigé par Claude
// (VEILLE_WORKDIR/veille.json), le met en page, l'envoie et l'archive. Essai à
// blanc (VEILLE_DRY_RUN=1) : rien n'est envoyé ni archivé, l'aperçu HTML est
// écrit dans VEILLE_OUT. À la main :
//   VEILLE_WORKDIR=veille-work VEILLE_DRY_RUN=1 pnpm --filter @catdesk/agent-runtime veille:send

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSmtpConfig, sendEmail } from '../lib/email';
import {
  CANDIDATES_FILE,
  RELEASES_FILE,
  REPORT_FILE,
  type RepoCandidate,
  type WatchedRelease,
} from '../news/veille/collectRepos';
import { renderVeilleHtml, renderVeilleMarkdown, veilleSubject } from '../news/veille/renderVeille';
import { archiveReport, readVeilleSendConfig } from '../news/veille/veilleConfig';
import { VeilleReportSchema, keepCollected } from '../news/veille/veilleSchema';
import { createLogger } from '../logger';

const log = createLogger('cli:veille-send');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8')) as unknown;
}

async function main(): Promise<number> {
  const parsed = readVeilleSendConfig(process.env);
  if (!parsed.ok) {
    log.error(parsed.error);
    return 1;
  }
  const cfg = parsed.config;

  // SMTP vérifié d'abord : une config cassée échoue avant la mise en page.
  const smtp = readSmtpConfig(process.env);
  if (!smtp.ok && !cfg.dryRun) {
    log.error(smtp.error);
    return 1;
  }

  const raw = VeilleReportSchema.safeParse(readJson(join(cfg.workdir, REPORT_FILE)));
  if (!raw.success) {
    log.error('Rapport rédigé par Claude non conforme au schéma', {
      issues: raw.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`),
    });
    return 1;
  }
  const candidates = readJson(join(cfg.workdir, CANDIDATES_FILE)) as RepoCandidate[];
  const releases = readJson(join(cfg.workdir, RELEASES_FILE)) as WatchedRelease[];
  const meta = readJson(join(cfg.workdir, 'meta.json')) as { now: string };

  const report = keepCollected(
    raw.data,
    new Set(candidates.map(c => c.repo)),
    new Set(releases.map(r => r.repo)),
  );
  const dropped = raw.data.pistes.length - report.pistes.length;
  const now = new Date(meta.now);
  const input = { report, now, candidateCount: candidates.length };
  const html = renderVeilleHtml(input);
  const markdown = renderVeilleMarkdown(input);
  const subject = veilleSubject(report);
  log.info('Rapport mis en page', {
    pistes: report.pistes.length,
    aFaire: report.pistes.filter(p => p.verdict === 'a_faire').length,
    releases: report.releases.length,
    rejected: report.rejected.length,
    ...(dropped > 0 ? { pistesHorsCollecte: dropped } : {}),
  });

  if (cfg.dryRun) {
    writeFileSync(cfg.out, html, 'utf-8');
    process.stdout.write(`${subject}\n\n${markdown}\n`);
    log.info('Essai à blanc : rien envoyé ni archivé, aperçu écrit', { out: cfg.out });
    return 0;
  }

  if (!smtp.ok || cfg.to === null) return 1; // déjà vérifié plus haut ; rassure le typage
  const res = await sendEmail(smtp.config, { to: cfg.to, subject, text: markdown, html });
  if (!res.ok) {
    log.error('Rapport non envoyé', { error: res.error });
    return 1;
  }
  // Ni adresse ni contenu : les logs d'un dépôt public sont publics.
  log.info('Rapport envoyé');

  archiveReport(cfg.archiveDir, { day: meta.now.slice(0, 10), markdown, candidates, releases });
  return 0;
}

main().then(
  code => {
    process.exitCode = code;
  },
  (err: unknown) => {
    log.error('Envoi en échec', { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  },
);
