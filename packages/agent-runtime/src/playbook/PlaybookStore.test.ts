import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PlaybookStore, approachSignature } from './PlaybookStore';

describe('approachSignature', () => {
  it('dedupes preserving first-use order', () => {
    expect(approachSignature(['read_file', 'read_file', 'run_command', 'read_file'])).toBe('read_file>run_command');
  });
  it('marks a toolless run', () => {
    expect(approachSignature([])).toBe('(réponse directe)');
  });
});

describe('PlaybookStore', () => {
  let dir: string;
  let store: PlaybookStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ndpb-test-'));
    store = new PlaybookStore(dir);
    await store.initialize();
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null before enough attempts', () => {
    store.record('debug', 'analyze_stacktrace', true);
    expect(store.bestApproach('debug', 2)).toBeNull();
  });

  it('accumulates successes/failures and surfaces the winning approach', () => {
    store.record('debug', 'analyze_stacktrace>read_file', true);
    store.record('debug', 'analyze_stacktrace>read_file', true);
    store.record('debug', 'run_command', false);
    store.record('debug', 'run_command', false);

    const best = store.bestApproach('debug', 2);
    expect(best?.approach).toBe('analyze_stacktrace>read_file');
    expect(best?.successRate).toBe(1);
    expect(best?.attempts).toBe(2);
  });

  it('ignores approaches with more failures than successes', () => {
    store.record('git', 'run_command', false);
    store.record('git', 'run_command', false);
    store.record('git', 'run_command', true);
    expect(store.bestApproach('git', 2)).toBeNull();
  });

  it('scopes by task type and persists across reopen', async () => {
    store.record('tests', 'generate_unit_tests', true);
    store.record('tests', 'generate_unit_tests', true);
    store.close();

    const reopened = new PlaybookStore(dir);
    await reopened.initialize();
    expect(reopened.bestApproach('tests', 2)?.approach).toBe('generate_unit_tests');
    expect(reopened.bestApproach('debug', 2)).toBeNull();
    reopened.close();
  });
});
