import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PlaybookStore } from './PlaybookStore';
import { EvolutionDaemon, type EvolutionReport } from './EvolutionDaemon';

describe('EvolutionDaemon', () => {
  let dir: string;
  let store: PlaybookStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'evo-test-'));
    store = new PlaybookStore(dir);
    await store.initialize();
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a proposals report derived from recorded traces', () => {
    // A clear winner and a failing approach for the same task type.
    for (let i = 0; i < 6; i++) store.record('tests', 'generate_unit_tests', true);
    for (let i = 0; i < 5; i++) store.record('tests', 'run_command>guess', false);

    const daemon = new EvolutionDaemon(store, { dataDir: dir });
    const report = daemon.runOnce(1234);

    expect(report.generatedAt).toBe(1234);
    expect(report.proposals.some(p => p.kind === 'prefer' && p.approach === 'generate_unit_tests')).toBe(true);
    expect(report.proposals.some(p => p.kind === 'avoid' && p.approach === 'run_command>guess')).toBe(true);

    const reportPath = join(dir, 'evolution-proposals.json');
    expect(existsSync(reportPath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(reportPath, 'utf-8')) as EvolutionReport;
    expect(onDisk.proposals).toHaveLength(report.proposals.length);
  });

  it('writes an empty report when there is no actionable signal', () => {
    store.record('git', 'git_commit', true); // single attempt → below minAttempts
    const daemon = new EvolutionDaemon(store, { dataDir: dir });
    const report = daemon.runOnce();
    expect(report.proposals).toEqual([]);
    expect(existsSync(join(dir, 'evolution-proposals.json'))).toBe(true);
  });

  it('start()/stop() are idempotent and do not throw', () => {
    const daemon = new EvolutionDaemon(store, { dataDir: dir, intervalMs: 60_000 });
    expect(() => { daemon.start(); daemon.start(); daemon.stop(); daemon.stop(); }).not.toThrow();
  });
});
