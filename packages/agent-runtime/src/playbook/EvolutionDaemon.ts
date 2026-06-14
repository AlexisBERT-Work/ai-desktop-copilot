import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { PlaybookStore } from './PlaybookStore';
import { analyzeEvolution, type EvolutionProposal, type AnalyzeOptions } from './analyzeEvolution';
import { createLogger } from '../logger';

const log = createLogger('playbook:evolution');

export interface EvolutionDaemonOptions extends AnalyzeOptions {
  /** How often the nightly analysis runs. Default 24h. */
  intervalMs?: number;
  /** Where to write the proposals report. Default CATDESK_DATA_DIR. */
  dataDir?: string;
}

export interface EvolutionReport {
  generatedAt: number;
  /** Proposals the user should review (preferred/avoided approaches, task types to revisit). */
  proposals: EvolutionProposal[];
}

/**
 * Nightly evolution daemon (CATDESK-CONCEPTS-AVANCES §8): periodically analyzes
 * the playbook traces, detects recurring failures and winning approaches, and
 * writes a *proposals* report for the user to review.
 *
 * Human-in-the-loop by design: it never edits prompts or the playbook itself —
 * it only surfaces advice (`evolution-proposals.json`). Deterministic and cheap
 * (no LLM, no GPU), so it runs on a plain interval without disturbing the user.
 */
export class EvolutionDaemon {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly intervalMs: number;
  private readonly reportPath: string;
  private readonly analyzeOpts: AnalyzeOptions;

  constructor(private store: PlaybookStore, opts: EvolutionDaemonOptions = {}) {
    this.intervalMs = opts.intervalMs ?? 24 * 60 * 60 * 1000;
    const dir = opts.dataDir ?? process.env['CATDESK_DATA_DIR'] ?? join(process.cwd(), 'data');
    mkdirSync(dir, { recursive: true });
    this.reportPath = join(dir, 'evolution-proposals.json');
    this.analyzeOpts = {
      ...(opts.minAttempts !== undefined ? { minAttempts: opts.minAttempts } : {}),
      ...(opts.goodRate !== undefined ? { goodRate: opts.goodRate } : {}),
      ...(opts.badRate !== undefined ? { badRate: opts.badRate } : {}),
    };
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => this.runOnce(), this.intervalMs);
    // Don't keep the process alive just for the nightly analysis.
    (this.timer as { unref?: () => void }).unref?.();
    log.info('EvolutionDaemon started', { intervalMs: this.intervalMs });
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Run one analysis pass: read traces, derive proposals, write the report.
   * Returns the report. Safe to call directly (tests). Never throws into the
   * caller — a maintenance failure must not take anything down.
   */
  runOnce(now = Date.now()): EvolutionReport {
    const report: EvolutionReport = { generatedAt: now, proposals: [] };
    try {
      const rows = this.store.allStrategies();
      report.proposals = analyzeEvolution(rows, this.analyzeOpts);
      writeFileSync(this.reportPath, JSON.stringify(report, null, 2), 'utf-8');
      if (report.proposals.length > 0) {
        log.info('Evolution proposals written', { count: report.proposals.length, path: this.reportPath });
      }
    } catch (err) {
      log.warn('Evolution pass failed', { error: err instanceof Error ? err.message : String(err) });
    }
    return report;
  }
}
