// Brief « Actu IA », étape 1/3 : collecte des articles candidats et
// préparation de la consigne pour Claude Code (.github/workflows/ai-recap.yml).
// Écrit dans RECAP_WORKDIR : candidates.json, prompt.md, brief.schema.json,
// meta.json. À la main :
//   RECAP_WORKDIR=recap-work pnpm --filter @catdesk/agent-runtime recap:collect

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBriefPrompt } from '../news/brief/briefPrompt';
import { briefJsonSchema } from '../news/brief/briefSchema';
import { CANDIDATES_FILE, collectCandidates } from '../news/brief/collectCandidates';
import { readCollectConfig } from '../news/brief/recapConfig';
import { createLogger } from '../logger';

const log = createLogger('cli:recap-collect');

async function main(): Promise<number> {
  const now = new Date();
  const parsed = readCollectConfig(process.env, now);
  if (!parsed.ok) {
    log.error(parsed.error);
    return 1;
  }
  const cfg = parsed.config;
  const since = new Date(now.getTime() - cfg.sinceHours * 3_600_000).toISOString();

  const { candidates, failed, totalFetched } = await collectCandidates(cfg);
  log.info('Candidats collectés', {
    sources: cfg.sourceIds.length,
    sinceHours: cfg.sinceHours,
    totalFetched,
    candidates: candidates.length,
    withImage: candidates.filter(c => c.image !== null).length,
    ...(failed.length > 0 ? { failed } : {}),
  });

  mkdirSync(cfg.workdir, { recursive: true });
  const write = (name: string, content: string) =>
    writeFileSync(join(cfg.workdir, name), content, 'utf-8');
  write(CANDIDATES_FILE, JSON.stringify(candidates, null, 2));
  write('brief.schema.json', JSON.stringify(briefJsonSchema()));
  write(
    'prompt.md',
    buildBriefPrompt({
      candidatesFile: CANDIDATES_FILE,
      candidateCount: candidates.length,
      since,
      now,
      audience: cfg.audience,
    }),
  );
  write('meta.json', JSON.stringify({ since, now: now.toISOString(), sinceHours: cfg.sinceHours }));

  // Rien à résumer : l'étape suivante ne doit pas lancer Claude pour rien.
  if (candidates.length === 0) log.warn('Aucun article dans la fenêtre');
  return 0;
}

main().then(
  code => {
    process.exitCode = code;
  },
  (err: unknown) => {
    log.error('Collecte en échec', { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  },
);
