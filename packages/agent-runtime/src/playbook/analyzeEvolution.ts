import type { StrategyRow } from './PlaybookStore';

/**
 * Trace analysis for the evolution daemon (CATDESK-CONCEPTS-AVANCES §8).
 *
 * Reads the playbook's success/failure traces and derives *proposals* about
 * which approaches to prefer or avoid per task type — recurring-failure
 * detection done with deterministic stats, no LLM. The output is advisory only:
 * proposals are surfaced for the user to review, never auto-applied to prompts
 * (the human-in-the-loop guardrail in §8).
 */

export type ProposalKind = 'prefer' | 'avoid' | 'review';

export interface EvolutionProposal {
  kind: ProposalKind;
  taskType: string;
  /** The approach the proposal is about ('prefer'/'avoid'); absent for 'review'. */
  approach?: string;
  /** For 'avoid': a better-performing alternative to steer toward, if one exists. */
  betterApproach?: string;
  successRate: number;
  attempts: number;
  /** Human-readable, French (user-facing) explanation of the proposal. */
  rationale: string;
}

export interface AnalyzeOptions {
  /** Min attempts before an approach carries enough signal to act on. Default 3. */
  minAttempts?: number;
  /** Success rate at/above which an approach counts as a clear winner. Default 0.6. */
  goodRate?: number;
  /** Success rate at/below which an approach counts as failing. Default 0.4. */
  badRate?: number;
}

interface ApproachStat {
  approach: string;
  attempts: number;
  successRate: number;
}

function pct(rate: number): number {
  return Math.round(rate * 100);
}

/**
 * Turn raw strategy rows into a prioritized list of proposals.
 *
 * Per task type, among approaches with enough attempts:
 * - if there's a clear winner → propose to PREFER it, and to AVOID any failing
 *   approach (pointing at the winner as the better alternative);
 * - if no approach wins → propose to REVIEW the task type (recurring failures
 *   with no working strategy → prompt/skill attention needed).
 */
export function analyzeEvolution(rows: StrategyRow[], opts: AnalyzeOptions = {}): EvolutionProposal[] {
  const minAttempts = opts.minAttempts ?? 3;
  const goodRate = opts.goodRate ?? 0.6;
  const badRate = opts.badRate ?? 0.4;

  // Group by task type.
  const byType = new Map<string, ApproachStat[]>();
  for (const r of rows) {
    const attempts = r.successes + r.failures;
    if (attempts < minAttempts) continue; // not enough signal
    const stat: ApproachStat = { approach: r.approach, attempts, successRate: r.successes / attempts };
    const list = byType.get(r.taskType) ?? [];
    list.push(stat);
    byType.set(r.taskType, list);
  }

  const proposals: EvolutionProposal[] = [];

  // Deterministic order over task types for stable output.
  for (const taskType of [...byType.keys()].sort()) {
    const stats = byType.get(taskType)!;

    // Best = highest success rate (tiebreak by attempts) among clear winners.
    const winners = stats
      .filter(s => s.successRate >= goodRate)
      .sort((a, b) => b.successRate - a.successRate || b.attempts - a.attempts);
    const best = winners[0];

    if (best) {
      proposals.push({
        kind: 'prefer',
        taskType,
        approach: best.approach,
        successRate: best.successRate,
        attempts: best.attempts,
        rationale:
          `Pour « ${taskType} », l'approche « ${best.approach} » réussit à ${pct(best.successRate)}% `
          + `sur ${best.attempts} essais — à privilégier par défaut.`,
      });

      for (const s of stats) {
        if (s.approach === best.approach) continue;
        if (s.successRate <= badRate) {
          proposals.push({
            kind: 'avoid',
            taskType,
            approach: s.approach,
            betterApproach: best.approach,
            successRate: s.successRate,
            attempts: s.attempts,
            rationale:
              `Pour « ${taskType} », l'approche « ${s.approach} » échoue souvent `
              + `(${pct(s.successRate)}% de succès sur ${s.attempts} essais) — préférer « ${best.approach} ».`,
          });
        }
      }
    } else {
      // No winning approach for this task type → recurring failures, needs review.
      const leastBad = [...stats].sort((a, b) => b.successRate - a.successRate)[0]!;
      const totalAttempts = stats.reduce((n, s) => n + s.attempts, 0);
      proposals.push({
        kind: 'review',
        taskType,
        successRate: leastBad.successRate,
        attempts: totalAttempts,
        rationale:
          `Pour « ${taskType} », aucune approche ne dépasse ${pct(goodRate)}% de succès `
          + `(meilleure : ${pct(leastBad.successRate)}% sur ${totalAttempts} essais cumulés). `
          + `Le prompt ou un nouveau skill mérite ton attention.`,
      });
    }
  }

  return proposals;
}
