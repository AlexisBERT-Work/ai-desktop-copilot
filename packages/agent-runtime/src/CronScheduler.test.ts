import { describe, it, expect, vi } from 'vitest';
import { parseScheduleMs, CronScheduler } from './CronScheduler';
import type { ConversationStore, ScheduledJob } from './memory/ConversationStore';
import type { SubAgentRunner } from './SubAgentRunner';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('parseScheduleMs', () => {
  it('gère les alias', () => {
    expect(parseScheduleMs('hourly')).toBe(HOUR);
    expect(parseScheduleMs('daily')).toBe(DAY);
    expect(parseScheduleMs('weekly')).toBe(7 * DAY);
  });

  it('gère "every N <unité>" avec formes courtes et longues', () => {
    expect(parseScheduleMs('every 5m')).toBe(5 * MIN);
    expect(parseScheduleMs('every 30 minutes')).toBe(30 * MIN);
    expect(parseScheduleMs('every 1h')).toBe(HOUR);
    expect(parseScheduleMs('every 2 hours')).toBe(2 * HOUR);
    expect(parseScheduleMs('every 1d')).toBe(DAY);
    expect(parseScheduleMs('every 3 days')).toBe(3 * DAY);
  });

  it('est insensible à la casse et tolère les espaces', () => {
    expect(parseScheduleMs('EVERY 5M')).toBe(5 * MIN);
    expect(parseScheduleMs('  every 5m  ')).toBe(5 * MIN);
  });

  it('renvoie null pour les formats invalides', () => {
    expect(parseScheduleMs('banana')).toBeNull();
    expect(parseScheduleMs('every 5x')).toBeNull();
    expect(parseScheduleMs('every minutes')).toBeNull();
    expect(parseScheduleMs('')).toBeNull();
  });
});

// ─── addJob (validation, sans démarrer le timer) ──────────────────

function makeScheduler() {
  const saved: ScheduledJob[] = [];
  const deleted: string[] = [];
  const store = {
    saveScheduledTask: (job: ScheduledJob) => { saved.push(job); },
    deleteScheduledTask: (id: string) => { deleted.push(id); },
    getScheduledTasks: () => [],
  } as unknown as ConversationStore;
  const runner = { run: vi.fn() } as unknown as SubAgentRunner;
  // On n'appelle PAS initialize() => aucun setInterval créé.
  return { scheduler: new CronScheduler(store, runner), saved, deleted };
}

describe('CronScheduler.addJob', () => {
  it('rejette un format de planification invalide', () => {
    const { scheduler } = makeScheduler();
    expect(() => scheduler.addJob('tâche', 'n importe quoi')).toThrow(/invalide/i);
  });

  it('rejette un intervalle sous la minute', () => {
    const { scheduler } = makeScheduler();
    expect(() => scheduler.addJob('tâche', 'every 0m')).toThrow(/minimum/i);
  });

  it('crée et persiste un job valide', () => {
    const { scheduler, saved } = makeScheduler();
    const before = Date.now();
    const job = scheduler.addJob('faire un truc', 'every 5m', { name: 'mon job' });

    expect(job.name).toBe('mon job');
    expect(job.schedule).toBe('every 5m');
    expect(job.enabled).toBe(true);
    expect(job.runCount).toBe(0);
    expect(job.nextRunAt).toBeGreaterThanOrEqual(before + 5 * MIN);
    expect(job.nextRunAt).toBeLessThanOrEqual(Date.now() + 5 * MIN + 1000);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.id).toBe(job.id);
  });

  it('cancelJob renvoie false pour un id inconnu', () => {
    const { scheduler } = makeScheduler();
    expect(scheduler.cancelJob('inexistant')).toBe(false);
  });

  it('cancelJob supprime un job existant', () => {
    const { scheduler, deleted } = makeScheduler();
    const job = scheduler.addJob('t', 'every 5m');
    expect(scheduler.cancelJob(job.id)).toBe(true);
    expect(deleted).toContain(job.id);
    expect(scheduler.listJobs()).toHaveLength(0);
  });
});
