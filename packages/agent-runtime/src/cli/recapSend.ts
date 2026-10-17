// Brief « Actu IA », étape 3/3 : valide le brief rédigé par Claude
// (RECAP_WORKDIR/brief.json), télécharge les visuels, met en page et envoie.
// Essai à blanc (RECAP_DRY_RUN=1) : rien n'est envoyé, l'aperçu HTML (images
// incluses) est écrit dans RECAP_OUT. À la main :
//   RECAP_WORKDIR=recap-work RECAP_DRY_RUN=1 pnpm --filter @catdesk/agent-runtime recap:send

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSmtpConfig, sendEmail } from '../lib/email';
import { buildBriefAssets } from '../news/brief/briefAssets';
import { BriefSchema } from '../news/brief/briefSchema';
import { BRIEF_FILE, CANDIDATES_FILE, type Candidate } from '../news/brief/collectCandidates';
import { readSendConfig } from '../news/brief/recapConfig';
import { briefSubject, renderBriefHtml, renderBriefText } from '../news/brief/renderBrief';
import { createLogger } from '../logger';

const log = createLogger('cli:recap-send');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8')) as unknown;
}

function extension(contentType: string): string {
  const sub = contentType.split('/')[1] ?? 'png';
  return sub === 'jpeg' ? 'jpg' : sub;
}

async function main(): Promise<number> {
  const parsed = readSendConfig(process.env);
  if (!parsed.ok) {
    log.error(parsed.error);
    return 1;
  }
  const cfg = parsed.config;

  // SMTP vérifié d'abord : une config cassée échoue avant tout téléchargement.
  const smtp = readSmtpConfig(process.env);
  if (!smtp.ok && !cfg.dryRun) {
    log.error(smtp.error);
    return 1;
  }

  const brief = BriefSchema.safeParse(readJson(join(cfg.workdir, BRIEF_FILE)));
  if (!brief.success) {
    log.error('Brief rédigé par Claude non conforme au schéma', {
      issues: brief.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`),
    });
    return 1;
  }
  const candidates = readJson(join(cfg.workdir, CANDIDATES_FILE)) as Candidate[];
  const meta = readJson(join(cfg.workdir, 'meta.json')) as { since: string; now: string };
  const since = new Date(meta.since);
  const now = new Date(meta.now);

  const assets = await buildBriefAssets(brief.data, candidates);
  log.info('Visuels prêts', {
    leads: brief.data.leads.length,
    images: assets.visuals.filter(v => v.image !== null).length,
    diagrams: assets.visuals.filter(v => v.diagram !== null).length,
  });

  const common = { brief: brief.data, since, now, candidateCount: candidates.length };
  const subject = briefSubject(brief.data, now);
  const text = renderBriefText(common);

  if (cfg.dryRun) {
    const byId = new Map(assets.images.map(a => [a.id, a]));
    const html = renderBriefHtml({
      ...common,
      visuals: assets.visuals,
      imageSrc: id => {
        const a = byId.get(id);
        return a ? `data:${a.contentType};base64,${a.body.toString('base64')}` : '';
      },
    });
    writeFileSync(cfg.out, html, 'utf-8');
    process.stdout.write(`${subject}\n\n${text}\n`);
    log.info('Essai à blanc : rien envoyé, aperçu écrit', { out: cfg.out, subject });
    return 0;
  }

  const html = renderBriefHtml({ ...common, visuals: assets.visuals, imageSrc: id => `cid:${id}` });
  if (!smtp.ok || cfg.to === null) return 1; // déjà vérifié plus haut ; rassure le typage
  const res = await sendEmail(smtp.config, {
    to: cfg.to,
    subject,
    text,
    html,
    inlineImages: assets.images.map(a => ({
      cid: a.id,
      filename: `${a.id}.${extension(a.contentType)}`,
      content: a.body,
      contentType: a.contentType,
    })),
  });
  if (!res.ok) {
    log.error('Brief non envoyé', { error: res.error });
    return 1;
  }
  // Ni adresse ni domaine : les logs d'un dépôt public sont publics, et le
  // domaine d'une adresse pro révèle l'employeur (vu le 2026-10-17).
  log.info('Brief envoyé', { subject, images: assets.images.length });
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
