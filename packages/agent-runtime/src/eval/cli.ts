/**
 * Banc de qualité de l'agent : joue le jeu de tâches contre un vrai modèle, avec
 * le vrai orchestrateur mais des outils simulés (rien de réel n'est touché).
 *
 *   pnpm --filter @catdesk/agent-runtime eval [options]
 *
 *   --selection          sélection d'outils seule : sans GPU, en une seconde
 *   --split dev|holdout  jeu à jouer (défaut : les deux)
 *   --only a,b           seulement ces identifiants de tâche
 *   --model qwen3:14b    modèle à évaluer (défaut : celui de CatDesk)
 *   --repeat 3           essais par tâche : à température réelle, un seul essai
 *                        est bruité
 *   --temperature 0      défaut : celle de l'orchestrateur. Les mesures de
 *                        docs/SUIVI.md sont à 0 : à rappeler pour s'y comparer
 *   --out rapport.json   défaut : data/eval/<date>-<modèle>.json
 *   --compare avant.json liste les tâches gagnées et perdues contre ce rapport
 *
 * Attention : les temps dépendent des réglages du serveur Ollama. Celui lancé par
 * CatDesk active `q4_0` et flash attention (voir core/ollama.rs), pas un Ollama
 * lancé à la main : ne comparer que des rapports issus du même serveur.
 */

import type { AgentConfig } from '@catdesk/shared-types';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseArgs } from 'util';

import { CONFIG } from '../config';
import { writeFileAtomic } from '../lib/persistence';
import { EVAL_TASKS, type EvalTask } from './evalTasks';
import { createHarness, runAttempt, serverLooksDown } from './runner';
import {
  compareRuns,
  selectionReport,
  summarize,
  type EvalSummary,
  type ScoredAttempt,
} from './scoring';
import { buildSimulatedRegistry } from './SimulatedToolRegistry';
import { simulatedWorld } from './simulatedWorld';

interface EvalReport {
  date: string;
  model: string;
  baseUrl: string;
  split: string;
  repeat: number;
  temperature: number | null;
  toolLimit: number;
  summary: EvalSummary;
  attempts: ScoredAttempt[];
  /** Le serveur est tombé en route : le rapport est partiel, son score ne vaut rien. */
  interrupted?: boolean;
}

const print = (line = ''): void => void process.stdout.write(`${line}\n`);
const percent = (part: number, total: number): string =>
  total === 0 ? '—' : `${part}/${total} (${Math.round((part / total) * 100)} %)`;
const seconds = (ms: number | null): string => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);

function pickTasks(split: string | undefined, only: string | undefined): EvalTask[] {
  const ids = only?.split(',').map(id => id.trim());
  return EVAL_TASKS.filter(
    task => (split === undefined || task.split === split) && (!ids || ids.includes(task.id)),
  );
}

function printSelection(tasks: EvalTask[]): void {
  const tools = buildSimulatedRegistry(simulatedWorld(new Date())).getEnabled();
  print(`Sélection d'outils — ${tools.length} outils, limite ${CONFIG.toolLimit}`);
  for (const split of ['dev', 'holdout']) {
    const subset = tasks.filter(task => task.split === split);
    if (subset.length === 0) continue;
    const { recall, coreOnly } = selectionReport(subset, tools, CONFIG.toolLimit);
    print(`\n${split}`);
    print(`  outil attendu proposé : ${percent(recall.hit, recall.total)}`);
    // Le détail du holdout reste caché : qui voit ses ratés finit par régler dessus.
    if (split === 'dev') for (const miss of recall.misses) print(`    raté : ${miss}`);
    print(`  noyau seul sans outil : ${percent(coreOnly.hit, coreOnly.total)}`);
    if (split === 'dev') {
      for (const { input, tools: extras } of coreOnly.extras) {
        print(`    en trop : ${input} -> ${extras.join(', ')}`);
      }
    }
  }
}

function printSummary(report: EvalReport): void {
  const { summary: s } = report;
  print(`\nRésultat — ${report.model}, ${s.attempts} essais`);
  print(`  outil proposé     ${percent(s.selected, s.attempts)}`);
  print(`  bon appel         ${percent(s.called, s.attempts)}`);
  print(`  bons arguments    ${percent(s.args, s.attempts)}`);
  print(`  bonne réponse     ${percent(s.answer, s.attempts)}`);
  print(`  réussite stricte  ${percent(s.passed, s.attempts)}`);
  print(`  appels à risque non demandés : ${s.sideEffects}`);
  print(
    `  temps médian : ${seconds(s.medianFirstTokenMs)} au premier token, ` +
      `${seconds(s.medianTotalMs)} au total`,
  );
  print('\nPar catégorie');
  for (const [name, row] of Object.entries(s.byCategory).sort()) {
    print(`  ${name.padEnd(15)} ${percent(row.passed, row.attempts)}`);
  }
}

function printComparison(path: string, report: EvalReport): void {
  const before = JSON.parse(readFileSync(path, 'utf8')) as EvalReport;
  const { gains, regressions } = compareRuns(before.attempts, report.attempts);
  const line = (d: { taskId: string; before: number; after: number }): string =>
    `  ${d.taskId} : ${Math.round(d.before * 100)} % -> ${Math.round(d.after * 100)} %`;
  print(`\nComparaison avec ${path}`);
  if (before.temperature !== report.temperature || before.model !== report.model) {
    print(
      `  ATTENTION : réglages différents, écarts sans valeur (avant : ${before.model}, ` +
        `température ${before.temperature ?? 'par défaut'} ; ` +
        `ici : ${report.model}, température ${report.temperature ?? 'par défaut'}).`,
    );
  }
  print(`  réussite stricte avant : ${percent(before.summary.passed, before.summary.attempts)}`);
  print(`Gains (${gains.length})`);
  gains.forEach(d => print(line(d)));
  print(`Régressions (${regressions.length})`);
  regressions.forEach(d => print(line(d)));
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      selection: { type: 'boolean', default: false },
      split: { type: 'string' },
      only: { type: 'string' },
      model: { type: 'string', default: CONFIG.model },
      repeat: { type: 'string', default: '1' },
      temperature: { type: 'string' },
      out: { type: 'string' },
      compare: { type: 'string' },
    },
  });

  // Les outils et l'audit écrivent sous ce dossier : jamais dans les vraies données.
  const dataDir = mkdtempSync(join(tmpdir(), 'catdesk-eval-'));
  process.env['CATDESK_DATA_DIR'] = dataDir;

  try {
    const tasks = pickTasks(values.split, values.only);
    if (values.selection) {
      printSelection(tasks);
      return;
    }

    const repeat = Number(values.repeat);
    const temperature = values.temperature !== undefined ? Number(values.temperature) : null;
    const config: AgentConfig = {
      model: values.model,
      ...(temperature !== null ? { temperature } : {}),
    };
    const playable = tasks.filter(task => !task.selectionOnly);
    const harness = createHarness(CONFIG.ollamaBaseUrl);

    print(`Banc de qualité — ${values.model}, ${playable.length} tâches × ${repeat}`);
    print('Chargement du modèle…');
    await harness.orchestrator.primeCache(undefined, values.model);

    const attempts: ScoredAttempt[] = [];
    const total = playable.length * repeat;
    for (let round = 1; round <= repeat && !serverLooksDown(attempts); round++) {
      for (const task of playable) {
        if (serverLooksDown(attempts)) break;
        const attempt = await runAttempt(harness, task, config, round);
        attempts.push(attempt);
        const mark = attempt.score.passed ? 'ok ' : 'KO ';
        print(`[${attempts.length}/${total}] ${mark} ${task.id} (${seconds(attempt.totalMs)})`);
      }
    }

    const interrupted = serverLooksDown(attempts);
    const report: EvalReport = {
      date: new Date().toISOString(),
      model: values.model,
      baseUrl: CONFIG.ollamaBaseUrl,
      split: values.split ?? 'tous',
      repeat,
      temperature,
      toolLimit: CONFIG.toolLimit,
      summary: summarize(playable, attempts),
      attempts,
      ...(interrupted ? { interrupted } : {}),
    };
    const out =
      values.out ??
      join(
        'data',
        'eval',
        `${report.date.slice(0, 19).replace(/[:T]/g, '-')}-${values.model.replace(/[^\w.-]/g, '_')}.json`,
      );
    writeFileAtomic(out, JSON.stringify(report, null, 2));

    if (interrupted) {
      const reason = attempts[attempts.length - 1]?.error ?? 'erreur inconnue';
      throw new Error(
        `Banc interrompu après ${attempts.length}/${total} essais : ${reason}\n` +
          `Aucun score à retenir. Rapport partiel : ${out}`,
      );
    }

    printSummary(report);
    if (values.compare !== undefined) printComparison(values.compare, report);
    print(`\nRapport : ${out}`);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
