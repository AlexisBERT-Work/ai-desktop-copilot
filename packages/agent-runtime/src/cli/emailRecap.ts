// Récap « Actu IA » sans l'application : point d'entrée lancé chaque matin par
// GitHub Actions (.github/workflows/ai-recap.yml), PC éteint. Utilisable aussi
// à la main, Ollama lancé :
//   RECAP_DRY_RUN=1 pnpm --filter @catdesk/agent-runtime recap:email
// Variables : RECAP_* (news/emailRecap.ts) et SMTP_* (lib/email.ts).

import { writeFileSync } from 'node:fs';
import { CONFIG } from '../config';
import { OllamaClient } from '../llm/OllamaClient';
import { maskEmail, readSmtpConfig, sendEmail } from '../lib/email';
import type { DailyMailer } from '../news/dailyEmail';
import { readRecapConfig, runEmailRecap } from '../news/emailRecap';
import { createLogger } from '../logger';

const log = createLogger('cli:email-recap');

async function main(): Promise<number> {
  const parsed = readRecapConfig(process.env);
  if (!parsed.ok) {
    log.error(parsed.error);
    return 1;
  }
  const cfg = parsed.config;

  // SMTP vérifié AVANT les minutes de LLM : une config cassée échoue tout de suite.
  const smtp = readSmtpConfig(process.env);
  let mailer: DailyMailer;
  if (smtp.ok) {
    const smtpConfig = smtp.config;
    mailer = msg => sendEmail(smtpConfig, msg);
  } else if (cfg.dryRun) {
    mailer = () => Promise.resolve(smtp);
  } else {
    log.error(smtp.error);
    return 1;
  }

  log.info('Récap : collecte et rédaction', {
    journal: cfg.name,
    sources: cfg.sourceIds.length,
    sinceHours: cfg.sinceHours,
    model: cfg.model,
    dryRun: cfg.dryRun,
    ...(cfg.to !== null ? { to: maskEmail(cfg.to) } : {}),
  });
  const llm = new OllamaClient({
    baseUrl: CONFIG.ollamaBaseUrl,
    numCtx: CONFIG.numCtx,
    keepAlive: '30m',
  });
  const outcome = await runEmailRecap(cfg, { llm, mailer });

  switch (outcome.state) {
    case 'sent':
      log.info('Récap envoyé', { subject: outcome.subject, articles: outcome.articles });
      return 0;
    case 'empty':
      log.info('Aucun article dans la fenêtre — rien à envoyer', { sinceHours: cfg.sinceHours });
      return 0;
    case 'dry-run':
      writeFileSync(cfg.out, outcome.html, 'utf-8');
      process.stdout.write(`${outcome.text}\n`);
      log.info('Essai à blanc : rien envoyé, aperçu écrit', {
        out: cfg.out,
        subject: outcome.subject,
        articles: outcome.articles,
      });
      return 0;
    case 'error':
      log.error('Récap non envoyé', { error: outcome.error });
      return 1;
  }
}

main().then(
  code => {
    process.exitCode = code;
  },
  (err: unknown) => {
    log.error('Récap en échec', { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  },
);
