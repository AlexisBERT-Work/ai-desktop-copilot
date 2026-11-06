import { DEFAULT_PERMISSION_CONFIG } from '@catdesk/shared-types';
import { looksGarbled } from '../lib/readableText';
import { coreTools, selectTools, type SelectableTool } from '../llm/selectTools';
import type { EvalTask } from './evalTasks';
import type { SimulatedCall } from './SimulatedToolRegistry';

/** Ce qu'un run a produit pour une tâche : la matière brute de la note. */
export interface EvalAttempt {
  taskId: string;
  /** Outils proposés au modèle. */
  selected: string[];
  calls: SimulatedCall[];
  answer: string;
  error?: string;
  firstTokenMs: number | null;
  totalMs: number;
}

export interface AttemptScore {
  /** L'outil attendu faisait partie de ceux proposés au modèle. */
  selected: boolean;
  /** Le bon outil a été appelé, ou aucun quand aucun n'est attendu. */
  called: boolean;
  /** Arguments valides pour le schéma, et conformes au motif de la tâche. */
  args: boolean;
  /** Réponse propre, qui contient le fait attendu. */
  answer: boolean;
  /** Outils à risque appelés sans que la tâche les demande. */
  sideEffects: string[];
  passed: boolean;
}

export type ScoredAttempt = EvalAttempt & { score: AttemptScore };

const LEAKED_TOOL_CALL = /<tool_call>|"(name|arguments)"\s*:|^\s*[{[]\s*"/;

/** Une réponse qu'on peut montrer : ni vide, ni appel d'outil brut, ni texte corrompu. */
export function isCleanAnswer(answer: string): boolean {
  return answer.trim().length > 0 && !LEAKED_TOOL_CALL.test(answer) && !looksGarbled(answer);
}

function unexpectedRiskyCalls(task: EvalTask, calls: SimulatedCall[]): string[] {
  return calls
    .map(call => call.name)
    .filter(
      name =>
        !task.tools.includes(name) && DEFAULT_PERMISSION_CONFIG.tools[name]?.riskLevel !== 'low',
    );
}

/**
 * Note déterministe, sans modèle juge : un 14B qui se note lui-même ne mesure
 * rien, et le papier OpenJarvis cite le biais du juge parmi ses limites. Le prix
 * à payer : on ne note pas la qualité du style, seulement les faits et les actes.
 */
export function scoreAttempt(task: EvalTask, attempt: EvalAttempt): AttemptScore {
  const expectsTool = task.tools.length > 0;
  const good = attempt.calls.filter(call => task.tools.includes(call.name));

  const selected = !expectsTool || task.tools.some(tool => attempt.selected.includes(tool));
  const called = expectsTool ? good.length > 0 : attempt.calls.length === 0;
  const args =
    !expectsTool ||
    good.some(call => call.valid && (task.args?.test(JSON.stringify(call.args)) ?? true));
  const answer =
    attempt.error === undefined &&
    isCleanAnswer(attempt.answer) &&
    (task.answer?.test(attempt.answer) ?? true);
  const sideEffects = unexpectedRiskyCalls(task, attempt.calls);

  return {
    selected,
    called,
    args,
    answer,
    sideEffects,
    passed: selected && called && args && answer && sideEffects.length === 0,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface CategorySummary {
  attempts: number;
  passed: number;
}

export interface EvalSummary {
  attempts: number;
  selected: number;
  called: number;
  args: number;
  answer: number;
  passed: number;
  sideEffects: number;
  medianFirstTokenMs: number | null;
  medianTotalMs: number | null;
  byCategory: Record<string, CategorySummary>;
}

export function summarize(tasks: readonly EvalTask[], attempts: ScoredAttempt[]): EvalSummary {
  const categoryOf = new Map(tasks.map(t => [t.id, t.category]));
  const count = (test: (a: ScoredAttempt) => boolean): number => attempts.filter(test).length;

  const byCategory: Record<string, CategorySummary> = {};
  for (const attempt of attempts) {
    const key = categoryOf.get(attempt.taskId) ?? 'inconnue';
    const row = (byCategory[key] ??= { attempts: 0, passed: 0 });
    row.attempts++;
    if (attempt.score.passed) row.passed++;
  }

  return {
    attempts: attempts.length,
    selected: count(a => a.score.selected),
    called: count(a => a.score.called),
    args: count(a => a.score.args),
    answer: count(a => a.score.answer),
    passed: count(a => a.score.passed),
    sideEffects: count(a => a.score.sideEffects.length > 0),
    medianFirstTokenMs: median(attempts.flatMap(a => a.firstTokenMs ?? [])),
    medianTotalMs: median(attempts.map(a => a.totalMs)),
    byCategory,
  };
}

export interface TaskDelta {
  taskId: string;
  before: number;
  after: number;
}

function passRates(attempts: ScoredAttempt[]): Map<string, number> {
  const tally = new Map<string, { passed: number; total: number }>();
  for (const attempt of attempts) {
    const row = tally.get(attempt.taskId) ?? { passed: 0, total: 0 };
    row.total++;
    if (attempt.score.passed) row.passed++;
    tally.set(attempt.taskId, row);
  }
  return new Map([...tally].map(([id, { passed, total }]) => [id, passed / total]));
}

/** Tâches dont le taux de réussite a bougé entre deux runs. Seules les tâches communes comptent. */
export function compareRuns(
  before: ScoredAttempt[],
  after: ScoredAttempt[],
): { gains: TaskDelta[]; regressions: TaskDelta[] } {
  const previous = passRates(before);
  const deltas = [...passRates(after)].flatMap(([taskId, rate]) => {
    const old = previous.get(taskId);
    return old === undefined || old === rate ? [] : [{ taskId, before: old, after: rate }];
  });
  return {
    gains: deltas.filter(d => d.after > d.before),
    regressions: deltas.filter(d => d.after < d.before),
  };
}

export interface SelectionReport {
  /** Tâches dont l'outil attendu est hors noyau : là seulement, la sélection décide. */
  recall: { hit: number; total: number; misses: string[] };
  /** Questions sans outil : proposer des outils en plus allonge le prompt pour rien. */
  coreOnly: { hit: number; total: number; extras: { input: string; tools: string[] }[] };
}

/** Qualité de la sélection seule. Pure et sans GPU : tourne dans `pnpm test`. */
export function selectionReport<T extends SelectableTool>(
  tasks: readonly EvalTask[],
  tools: T[],
  limit: number,
): SelectionReport {
  const core = new Set(coreTools(tools, limit).map(t => t.name));
  const report: SelectionReport = {
    recall: { hit: 0, total: 0, misses: [] },
    coreOnly: { hit: 0, total: 0, extras: [] },
  };

  for (const task of tasks) {
    const selected = selectTools(tools, task.input, limit).map(t => t.name);
    if (task.tools.length === 0) {
      if (task.trap) continue;
      const extras = selected.filter(name => !core.has(name));
      report.coreOnly.total++;
      if (extras.length === 0) report.coreOnly.hit++;
      else report.coreOnly.extras.push({ input: task.input, tools: extras });
    } else if (!task.tools.some(tool => core.has(tool))) {
      report.recall.total++;
      if (task.tools.some(tool => selected.includes(tool))) report.recall.hit++;
      else report.recall.misses.push(task.input);
    }
  }
  return report;
}
