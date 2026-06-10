import { randomUUID } from 'crypto';
import type { ConversationStore, ScheduledJob } from './memory/ConversationStore';
import type { SubAgentRunner } from './SubAgentRunner';
import { createLogger } from './logger';

const log = createLogger('runtime:cron');

const TICK_INTERVAL_MS = 60_000;
const MAX_RESULT_CHARS = 2_000;

// ─── Schedule Parser ──────────────────────────────────────────────

const SCHEDULE_ALIASES: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

const EVERY_RE = /^every\s+(\d+)\s*(m|min|minutes?|h|hours?|d|days?)$/i;

export function parseScheduleMs(schedule: string): number | null {
  const s = schedule.trim().toLowerCase();

  const alias = SCHEDULE_ALIASES[s];
  if (alias !== undefined) return alias;

  const m = EVERY_RE.exec(s);
  if (m) {
    const num = parseInt(m[1]!, 10);
    const unit = m[2]!.toLowerCase();
    if (unit.startsWith('m')) return num * 60 * 1000;
    if (unit.startsWith('h')) return num * 60 * 60 * 1000;
    if (unit.startsWith('d')) return num * 24 * 60 * 60 * 1000;
  }

  return null;
}

export function validScheduleFormats(): string {
  return '"every 5m", "every 30m", "every 1h", "every 6h", "every 1d", "hourly", "daily", "weekly"';
}

// ─── CronScheduler ────────────────────────────────────────────────

export class CronScheduler {
  private jobs = new Map<string, ScheduledJob>();
  private running = new Set<string>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private store: ConversationStore,
    private runner: SubAgentRunner,
  ) {}

  async initialize(): Promise<void> {
    const persisted = this.store.getScheduledTasks();
    for (const job of persisted) {
      this.jobs.set(job.id, job);
    }
    this.tickTimer = setInterval(() => { void this.tick(); }, TICK_INTERVAL_MS);
    // Run overdue jobs immediately on startup
    void this.tick();
    log.info('CronScheduler initialized', { jobs: persisted.length });
  }

  // ─── Job CRUD ───────────────────────────────────────────────────

  addJob(task: string, schedule: string, opts: { name?: string; enabled?: boolean } = {}): ScheduledJob {
    const intervalMs = parseScheduleMs(schedule);
    if (intervalMs === null) {
      throw new Error(`Format de planification invalide: "${schedule}". Formats acceptés: ${validScheduleFormats()}`);
    }
    if (intervalMs < 60_000) {
      throw new Error('Intervalle minimum: 1 minute');
    }

    const id = randomUUID();
    const now = Date.now();
    const job: ScheduledJob = {
      id,
      name: opts.name ?? task.slice(0, 60),
      task,
      schedule,
      enabled: opts.enabled !== false,
      createdAt: now,
      nextRunAt: now + intervalMs,
      runCount: 0,
    };

    this.jobs.set(id, job);
    this.store.saveScheduledTask(job);
    log.info('Job scheduled', { id, name: job.name, schedule, nextRunAt: new Date(job.nextRunAt).toISOString() });
    return job;
  }

  cancelJob(id: string): boolean {
    if (!this.jobs.has(id)) return false;
    this.jobs.delete(id);
    this.store.deleteScheduledTask(id);
    log.info('Job cancelled', { id });
    return true;
  }

  listJobs(): ScheduledJob[] {
    return [...this.jobs.values()];
  }

  shutdown(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    log.info('CronScheduler stopped');
  }

  // ─── Tick Loop ──────────────────────────────────────────────────

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const [, job] of this.jobs) {
      if (!job.enabled) continue;
      if (this.running.has(job.id)) continue;
      if (job.nextRunAt <= now) {
        void this.runJob(job);
      }
    }
  }

  private async runJob(job: ScheduledJob): Promise<void> {
    this.running.add(job.id);
    const startedAt = Date.now();
    log.info('Running scheduled job', { id: job.id, name: job.name });

    const intervalMs = parseScheduleMs(job.schedule) ?? 60 * 60 * 1000;
    const nextRunAt = startedAt + intervalMs;

    let lastResult: string | undefined;
    let lastError: string | undefined;

    try {
      const result = await this.runner.run(job.task, { maxIterations: 6 });
      const summary = result.success
        ? (result.output ?? 'Terminé').slice(0, MAX_RESULT_CHARS)
        : `Échec: ${result.error ?? 'erreur inconnue'}`.slice(0, MAX_RESULT_CHARS);

      if (result.success) {
        lastResult = summary;
      } else {
        lastError = summary;
      }

      log.info('Scheduled job completed', {
        id: job.id,
        success: result.success,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      lastError = String(err).slice(0, MAX_RESULT_CHARS);
      log.error('Scheduled job threw', { id: job.id, error: lastError });
    }

    // Update in-memory state
    const updated: ScheduledJob = {
      ...job,
      lastRunAt: startedAt,
      nextRunAt,
      runCount: job.runCount + 1,
      ...(lastResult !== undefined ? { lastResult } : {}),
      ...(lastError !== undefined ? { lastError } : {}),
    };
    this.jobs.set(job.id, updated);

    // Persist
    this.store.updateScheduledTaskRun(job.id, {
      lastRunAt: startedAt,
      nextRunAt,
      ...(lastResult !== undefined ? { lastResult } : {}),
      ...(lastError !== undefined ? { lastError } : {}),
    });

    this.running.delete(job.id);
  }
}
