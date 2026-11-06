// Veille GitHub, étape 1/3 : collecte des dépôts candidats et préparation de la
// consigne pour Claude Code (.github/workflows/ai-veille.yml). Aucun LLM ici.
// Écrit dans VEILLE_WORKDIR : candidates.json, releases.json, readmes/,
// contexte/, prompt.md, veille.schema.json, meta.json. À la main :
//   GH_TOKEN=$(gh auth token) VEILLE_WORKDIR=veille-work pnpm --filter @catdesk/agent-runtime veille:collect

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  CANDIDATES_FILE,
  RELEASES_FILE,
  REPORT_FILE,
  collectRepos,
  githubSource,
} from '../news/veille/collectRepos';
import { loadVeilleState, readVeilleCollectConfig } from '../news/veille/veilleConfig';
import { buildVeillePrompt } from '../news/veille/veillePrompt';
import { EMPTY_REPORT, veilleJsonSchema } from '../news/veille/veilleSchema';
import { createLogger } from '../logger';

const log = createLogger('cli:veille-collect');

/** Ce que CatDesk sait déjà faire et ce qui est prévu : sans ça, Claude proposerait l'existant. */
const CONTEXT_FILES = [
  'docs/CAPACITES.md',
  'docs/AMELIORATIONS.md',
  'docs/LIMITES.md',
  'packages/agent-runtime/src/tools/registerTools.ts',
];

/** Une recherche toutes les 2 s : sous le plafond de 30 par minute. */
const SEARCH_PAUSE_MS = 2_100;

function copyContext(contextDir: string, workdir: string): string[] {
  const copied: string[] = [];
  mkdirSync(join(workdir, 'contexte'), { recursive: true });
  for (const file of CONTEXT_FILES) {
    const source = join(contextDir, file);
    if (!existsSync(source)) {
      log.warn('Fichier de contexte absent', { file });
      continue;
    }
    const target = join('contexte', basename(file));
    copyFileSync(source, join(workdir, target));
    copied.push(target.replace(/\\/g, '/'));
  }
  return copied;
}

async function main(): Promise<number> {
  const now = new Date();
  const parsed = readVeilleCollectConfig(process.env);
  if (!parsed.ok) {
    log.error(parsed.error);
    return 1;
  }
  const cfg = parsed.config;

  const { candidates, releases, readmes, failed, queried } = await collectRepos(
    githubSource(cfg.token),
    {
      state: loadVeilleState(cfg.archiveDir),
      now,
      windowDays: cfg.windowDays,
      perDomain: cfg.perDomain,
      pauseMs: SEARCH_PAUSE_MS,
    },
  );
  const perDomain: Record<string, number> = {};
  for (const c of candidates) perDomain[c.domain] = (perDomain[c.domain] ?? 0) + 1;
  log.info('Dépôts collectés', {
    queried,
    candidates: candidates.length,
    perDomain,
    suspects: candidates.filter(c => c.suspect).length,
    readmes: readmes.size,
    releases: releases.length,
    ...(failed.length > 0 ? { failed } : {}),
  });

  mkdirSync(cfg.workdir, { recursive: true });
  const write = (name: string, content: string) => {
    const path = join(cfg.workdir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf-8');
  };
  write(CANDIDATES_FILE, JSON.stringify(candidates, null, 2));
  write(RELEASES_FILE, JSON.stringify(releases, null, 2));
  for (const [file, text] of readmes) write(file, text);
  write('veille.schema.json', JSON.stringify(veilleJsonSchema()));
  write(
    'prompt.md',
    buildVeillePrompt({
      candidateCount: candidates.length,
      releaseCount: releases.length,
      contextFiles: copyContext(cfg.contextDir, cfg.workdir),
      now,
    }),
  );
  write('meta.json', JSON.stringify({ now: now.toISOString() }));

  // Rien à résumer : le rapport est déjà écrit, Claude n'est pas lancé.
  if (candidates.length === 0 && releases.length === 0) {
    log.warn('Rien de neuf aujourd’hui');
    write(REPORT_FILE, JSON.stringify(EMPTY_REPORT));
  }

  // Plus de la moitié des sources en échec : GitHub va mal, pas un jour calme.
  // Le run échoue, rien n'est marqué comme vu, tout revient demain.
  if (failed.length * 2 > queried) {
    log.error('Trop de sources en échec', { failed: failed.length, queried });
    return 1;
  }
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
