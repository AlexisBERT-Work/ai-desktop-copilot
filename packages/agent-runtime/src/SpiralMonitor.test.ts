import { describe, it, expect } from 'vitest';
import { ActivityTracker, deriveSignature, deriveKind } from './ActivityTracker';
import { SpiralMonitor } from './SpiralMonitor';

describe('deriveSignature', () => {
  it('préfère le chemin de fichier', () => {
    expect(deriveSignature('read_file', { path: 'src/a.ts' })).toBe('file:src/a.ts');
  });
  it('utilise la première ligne de stacktrace', () => {
    expect(deriveSignature('analyze_stacktrace', { stacktrace: 'TypeError: boom\n at x' })).toBe('error:TypeError: boom');
  });
  it('réduit une commande à son premier token', () => {
    expect(deriveSignature('run_command', { command: 'npm run test -- foo' })).toBe('cmd:npm');
  });
  it('retombe sur le nom de l\'outil', () => {
    expect(deriveSignature('docker_ps', {})).toBe('tool:docker_ps');
  });
});

describe('deriveKind', () => {
  it('marque error sur échec', () => {
    expect(deriveKind('read_file', false)).toBe('error');
  });
  it('marque error pour les outils de debug même en succès', () => {
    expect(deriveKind('analyze_stacktrace', true)).toBe('error');
  });
  it('undefined pour un succès normal', () => {
    expect(deriveKind('read_file', true)).toBeUndefined();
  });
});

describe('ActivityTracker', () => {
  it('élague hors fenêtre temporelle', () => {
    let now = 1_000_000;
    const t = new ActivityTracker(1000, 100, () => now);
    t.record('a');
    now += 2000; // past the 1s window
    t.record('b');
    const recent = t.recent();
    expect(recent).toHaveLength(1);
    expect(recent[0]?.signature).toBe('b');
  });

  it('plafonne le nombre d\'événements', () => {
    let now = 0;
    const t = new ActivityTracker(10_000_000, 3, () => now);
    for (let i = 0; i < 5; i++) { now += 1; t.record(`s${i}`); }
    expect(t.recent()).toHaveLength(3);
  });
});

describe('SpiralMonitor', () => {
  function stuckTracker(now: () => number): ActivityTracker {
    const t = new ActivityTracker(3 * 60 * 60 * 1000, 500, now);
    // 5 events on the same file spread over 60 min, with failures.
    const base = now();
    const evts = [60, 50, 35, 15, 2];
    // record() uses now(); fake by temporarily overriding via direct push is hard,
    // so build a tracker whose now returns decreasing offsets through a queue.
    return seed(t, base, evts);
  }

  function seed(t: ActivityTracker, base: number, minutesAgo: number[]): ActivityTracker {
    // Re-create with a now() that yields the intended timestamps in order.
    const times = minutesAgo.map(m => base - m * 60_000);
    let i = 0;
    const tracker = new ActivityTracker(3 * 60 * 60 * 1000, 500, () => times[i] ?? base);
    for (i = 0; i < times.length; i++) tracker.record('file:auth.ts', 'error');
    return tracker;
  }

  it('émet une suggestion quand l\'utilisateur boucle', () => {
    const now = () => 10_000_000;
    const tracker = stuckTracker(now);
    const sent: Array<{ method: string; params: unknown }> = [];
    const monitor = new SpiralMonitor(tracker, (method, params) => sent.push({ method, params }), { thresholdMinutes: 45, now });
    const { verdict, notified } = monitor.tick();
    expect(verdict.spiraling).toBe(true);
    expect(notified).toBe(true);
    expect(sent[0]?.method).toBe('proactive.suggestion');
  });

  it('respecte le cooldown pour la même signature', () => {
    let clock = 10_000_000;
    const tracker = stuckTracker(() => 10_000_000);
    const sent: unknown[] = [];
    const monitor = new SpiralMonitor(tracker, (_m, p) => sent.push(p), { thresholdMinutes: 45, cooldownMs: 30 * 60_000, now: () => clock });
    expect(monitor.tick().notified).toBe(true);
    clock += 60_000; // 1 min later, same topic
    expect(monitor.tick().notified).toBe(false);
    clock += 31 * 60_000; // past cooldown
    expect(monitor.tick().notified).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it('ne notifie pas sans spirale', () => {
    const now = () => 10_000_000;
    const tracker = new ActivityTracker(3 * 60 * 60 * 1000, 500, now);
    tracker.record('file:a.ts');
    const sent: unknown[] = [];
    const monitor = new SpiralMonitor(tracker, (_m, p) => sent.push(p), { now });
    expect(monitor.tick().notified).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
