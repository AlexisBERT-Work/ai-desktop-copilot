// Publie dans le Fil (PWA catdesk-fil) les cartes tirées d'un rapport déjà
// produit : aucun appel de LLM. Lancé par les workflows après l'envoi du mail,
// pour qu'un échec ici ne prive jamais du mail. À la main :
//   RECAP_WORKDIR=recap-work FIL_SUPABASE_URL=… FIL_SUPABASE_ANON_KEY=… FIL_PUBLISH_TOKEN=… \
//     pnpm --filter @catdesk/agent-runtime fil:publish -- --from brief
// Les logs ne portent que des nombres : ceux d'un dépôt public sont publics.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BriefSchema } from '../news/brief/briefSchema';
import { BRIEF_FILE } from '../news/brief/collectCandidates';
import { recapWorkdir } from '../news/brief/recapConfig';
import { type FilCard, briefToCards, parisDay } from '../news/fil/filCards';
import { publishFil, readFilPublishConfig } from '../news/fil/publishFil';
import { createLogger } from '../logger';

const log = createLogger('cli:fil-publish');

type EnvLike = Record<string, string | undefined>;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8')) as unknown;
}

function briefCards(env: EnvLike): FilCard[] {
  const dir = recapWorkdir(env);
  const brief = BriefSchema.parse(readJson(join(dir, BRIEF_FILE)));
  const meta = readJson(join(dir, 'meta.json')) as { now: string };
  return briefToCards(brief, parisDay(new Date(meta.now)));
}

/** Rapports publiables, par nom de `--from`. */
const SOURCES: Record<string, (env: EnvLike) => FilCard[]> = {
  brief: briefCards,
};

function sourceArg(argv: readonly string[]): string | null {
  const i = argv.indexOf('--from');
  return i >= 0 ? (argv[i + 1] ?? null) : null;
}

async function main(): Promise<number> {
  const from = sourceArg(process.argv.slice(2));
  const toCards = from === null ? undefined : SOURCES[from];
  if (toCards === undefined) {
    log.error('Source inconnue', { from, attendu: Object.keys(SOURCES) });
    return 1;
  }
  const parsed = readFilPublishConfig(process.env);
  if (!parsed.ok) {
    log.error(parsed.error);
    return 1;
  }

  const cards = toCards(process.env);
  const perKind: Record<string, number> = {};
  for (const c of cards) perKind[c.kind] = (perKind[c.kind] ?? 0) + 1;

  const res = await publishFil(parsed.config, cards);
  if (!res.ok) {
    log.error('Cartes non publiées', { from, error: res.error });
    return 1;
  }
  log.info('Cartes publiées dans le Fil', {
    from,
    cartes: cards.length,
    nouvelles: res.inserted,
    perKind,
  });
  return 0;
}

main().then(
  code => {
    process.exitCode = code;
  },
  (err: unknown) => {
    log.error('Publication en échec', { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  },
);
