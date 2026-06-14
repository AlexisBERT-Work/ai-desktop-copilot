import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { PlaybookStore } from './PlaybookStore';
import { analyzeEvolution, type EvolutionProposal, type AnalyzeOptions } from './analyzeEvolution';
import { proposeSkills, type ProposeSkillsOptions } from './proposeSkills';
import { createLogger } from '../logger';

const log = createLogger('playbook:evolution');

export interface EvolutionDaemonOptions extends AnalyzeOptions, ProposeSkillsOptions {
  /** How often the nightly analysis runs. Default 24h. */
  intervalMs?: number;
  /** Where to write the proposals report. Default CATDESK_DATA_DIR. */
  dataDir?: string;
}

export interface EvolutionReport {
  generatedAt: number;
  /** Proposals the user should review (preferred/avoided approaches, task types to revisit). */
  proposals: EvolutionProposal[];
  /** Slugs of draft skills written this pass (one .md each under skill-drafts/). */
  skillDrafts: string[];
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
  private readonly dir: string;
  private readonly reportPath: string;
  private readonly analyzeOpts: AnalyzeOptions;
  private readonly skillOpts: ProposeSkillsOptions;

  constructor(private store: PlaybookStore, opts: EvolutionDaemonOptions = {}) {
    this.intervalMs = opts.intervalMs ?? 24 * 60 * 60 * 1000;
    this.dir = opts.dataDir ?? process.env['CATDESK_DATA_DIR'] ?? join(process.cwd(), 'data');
    mkdirSync(this.dir, { recursive: true });
    this.reportPath = join(this.dir, 'evolution-proposals.json');
    this.analyzeOpts = {
      ...(opts.minAttempts !== undefined ? { minAttempts: opts.minAttempts } : {}),
      ...(opts.goodRate !== undefined ? { goodRate: opts.goodRate } : {}),
      ...(opts.badRate !== undefined ? { badRate: opts.badRate } : {}),
    };
    this.skillOpts = {
      ...(opts.minAttempts !== undefined ? { minAttempts: opts.minAttempts } : {}),
      ...(opts.strongRate !== undefined ? { strongRate: opts.strongRate } : {}),
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
   * Run one analysis pass: read traces, derive proposals, draft skills from the
   * strongest winners, and write everything out. Returns the report. Safe to
   * call directly (tests). Never throws into the caller — a maintenance failure
   * must not take anything down.
   */
  runOnce(now = Date.now()): EvolutionReport {
    const report: EvolutionReport = { generatedAt: now, proposals: [], skillDrafts: [] };
    try {
      const rows = this.store.allStrategies();
      report.proposals = analyzeEvolution(rows, this.analyzeOpts);

      // §8-D: codify the strongest, generalizable winners as draft skills.
      // Human-in-the-loop: written under skill-drafts/, never installed.
      const drafts = proposeSkills(rows, this.skillOpts);
      if (drafts.length > 0) {
        const draftsDir = join(this.dir, 'skill-drafts');
        mkdirSync(draftsDir, { recursive: true });
        for (const d of drafts) {
          writeFileSync(join(draftsDir, `${d.slug}.md`), d.markdown, 'utf-8');
          report.skillDrafts.push(d.slug);
        }
      }

      writeFileSync(this.reportPath, JSON.stringify(report, null, 2), 'utf-8');
      if (report.proposals.length > 0 || report.skillDrafts.length > 0) {
        log.info('Evolution pass written', {
          proposals: report.proposals.length,
          skillDrafts: report.skillDrafts.length,
          path: this.reportPath,
        });
      }
    } catch (err) {
      log.warn('Evolution pass failed', { error: err instanceof Error ? err.message : String(err) });
    }
    return report;
  }
}
