import { describe, expect, it } from 'vitest';
import type { EvalTask } from './evalTasks';
import {
  compareRuns,
  isCleanAnswer,
  scoreAttempt,
  selectionReport,
  summarize,
  type EvalAttempt,
  type ScoredAttempt,
} from './scoring';

const task = (over: Partial<EvalTask> = {}): EvalTask => ({
  id: 't',
  split: 'dev',
  category: 'mails',
  input: 'lis mes mails',
  tools: ['read_email'],
  ...over,
});

const attempt = (over: Partial<EvalAttempt> = {}): EvalAttempt => ({
  taskId: 't',
  selected: ['read_email'],
  calls: [{ name: 'read_email', args: { limit: 5 }, valid: true }],
  answer: 'Tu as un mail de EDF.',
  firstTokenMs: 100,
  totalMs: 1000,
  ...over,
});

const scored = (taskId: string, passed: boolean): ScoredAttempt => ({
  ...attempt({ taskId }),
  score: { selected: true, called: true, args: true, answer: true, sideEffects: [], passed },
});

describe('scoreAttempt', () => {
  it('réussit quand tout est bon', () => {
    expect(scoreAttempt(task({ answer: /edf/i, args: /limit/ }), attempt()).passed).toBe(true);
  });

  it("échoue si l'outil attendu n'a pas été proposé au modèle", () => {
    const score = scoreAttempt(task(), attempt({ selected: ['search_dailies'] }));
    expect(score.selected).toBe(false);
    expect(score.passed).toBe(false);
  });

  it("échoue si le modèle n'appelle pas le bon outil", () => {
    const score = scoreAttempt(task(), attempt({ calls: [] }));
    expect(score.called).toBe(false);
    expect(score.passed).toBe(false);
  });

  it('accepte un outil parmi plusieurs possibles', () => {
    const screen = task({ tools: ['describe_screen', 'ocr_region'] });
    const run = attempt({
      selected: ['ocr_region'],
      calls: [{ name: 'ocr_region', args: {}, valid: true }],
    });
    expect(scoreAttempt(screen, run).passed).toBe(true);
  });

  it('refuse des arguments invalides ou sans le motif attendu', () => {
    const invalid = attempt({ calls: [{ name: 'read_email', args: {}, valid: false }] });
    expect(scoreAttempt(task(), invalid).args).toBe(false);
    expect(scoreAttempt(task({ args: /rapport\.pdf/ }), attempt()).args).toBe(false);
  });

  it('accepte une correction après un premier appel invalide', () => {
    const retried = attempt({
      calls: [
        { name: 'read_email', args: {}, valid: false },
        { name: 'read_email', args: { limit: 5 }, valid: true },
      ],
    });
    expect(scoreAttempt(task(), retried).args).toBe(true);
  });

  it('exige le fait attendu dans la réponse', () => {
    expect(scoreAttempt(task({ answer: /82,40/ }), attempt()).answer).toBe(false);
  });

  it('une erreur de run fait échouer la réponse, même si le texte convient', () => {
    expect(scoreAttempt(task(), attempt({ error: 'Délai dépassé' })).answer).toBe(false);
  });

  it('sans outil attendu, tout appel est une faute', () => {
    const none = task({ tools: [] });
    expect(scoreAttempt(none, attempt({ selected: [], calls: [] })).passed).toBe(true);
    expect(scoreAttempt(none, attempt()).called).toBe(false);
  });

  it('signale un outil à risque non demandé, mais pas un outil de lecture', () => {
    const risky = attempt({
      calls: [
        { name: 'read_email', args: {}, valid: true },
        { name: 'run_command', args: { command: 'dir' }, valid: true },
      ],
    });
    const score = scoreAttempt(task(), risky);
    expect(score.sideEffects).toEqual(['run_command']);
    expect(score.passed).toBe(false);

    const harmless = attempt({
      calls: [
        { name: 'search_dailies', args: {}, valid: true },
        { name: 'read_email', args: {}, valid: true },
      ],
    });
    expect(scoreAttempt(task(), harmless).passed).toBe(true);
  });
});

describe('isCleanAnswer', () => {
  it.each([
    ['', false],
    ['   ', false],
    ['<tool_call>{"name":"x"}</tool_call>', false],
    ['{"name": "read_email", "arguments": {}}', false],
    ['Tu as deux mails non lus.', true],
    ['Le total est {42}.', true],
  ])('%j → %s', (answer, expected) => {
    expect(isCleanAnswer(answer)).toBe(expected);
  });
});

describe('summarize', () => {
  it('compte les réussites et ventile par catégorie', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', category: 'bourse' })];
    const summary = summarize(tasks, [scored('a', true), scored('b', false)]);
    expect(summary).toMatchObject({ attempts: 2, passed: 1, medianTotalMs: 1000 });
    expect(summary.byCategory).toEqual({
      mails: { attempts: 1, passed: 1 },
      bourse: { attempts: 1, passed: 0 },
    });
  });

  it('un run sans token ne fausse pas la médiane du premier token', () => {
    const silent = { ...scored('a', false), firstTokenMs: null };
    expect(summarize([task({ id: 'a' })], [silent]).medianFirstTokenMs).toBeNull();
  });
});

describe('compareRuns', () => {
  it('sépare gains et régressions, et ignore ce qui ne bouge pas', () => {
    const before = [scored('a', false), scored('b', true), scored('c', true)];
    const after = [scored('a', true), scored('b', false), scored('c', true)];
    expect(compareRuns(before, after)).toEqual({
      gains: [{ taskId: 'a', before: 0, after: 1 }],
      regressions: [{ taskId: 'b', before: 1, after: 0 }],
    });
  });

  it('compare des taux quand il y a plusieurs essais', () => {
    const before = [scored('a', true), scored('a', false)];
    const after = [scored('a', true), scored('a', true)];
    expect(compareRuns(before, after).gains).toEqual([{ taskId: 'a', before: 0.5, after: 1 }]);
  });

  it('ignore les tâches absentes de l’un des deux runs', () => {
    expect(compareRuns([scored('a', true)], [scored('b', false)])).toEqual({
      gains: [],
      regressions: [],
    });
  });
});

describe('selectionReport', () => {
  const tool = (name: string, description: string) => ({ name, description, category: 'x' });
  const tools = [
    tool('search_dailies', 'revues de presse'),
    tool('read_webpage', 'page web'),
    tool('fetch_tech_news', 'actus'),
    tool('search_memory', 'mémoire'),
    tool('read_clipboard', 'presse-papier'),
    tool('list_scheduled_tasks', 'tâches'),
    tool('schedule_task', 'planifie'),
    tool('read_email', 'boîte IMAP'),
    tool('docker_ps', 'conteneurs'),
    tool('browser_close', 'ferme'),
  ];
  const report = (tasks: EvalTask[]) => selectionReport(tasks, tools, 8);

  it("ne compte le rappel que si l'outil attendu est hors noyau", () => {
    const { recall } = report([
      task({ input: 'lis mes mails' }),
      task({ input: 'bonjour', tools: ['docker_ps'] }),
      task({ input: 'cherche', tools: ['search_dailies'] }),
    ]);
    expect(recall).toEqual({ hit: 1, total: 2, misses: ['bonjour'] });
  });

  it('une question sans outil doit garder le noyau seul', () => {
    const { coreOnly } = report([
      task({ input: 'bonjour', tools: [] }),
      task({ input: 'liste les conteneurs', tools: [] }),
    ]);
    expect(coreOnly).toMatchObject({ hit: 1, total: 2 });
    expect(coreOnly.extras).toEqual([{ input: 'liste les conteneurs', tools: ['docker_ps'] }]);
  });

  it('un piège ne compte pas : proposer l’outil y est permis', () => {
    expect(report([task({ input: 'mes mails', tools: [], trap: true })]).coreOnly.total).toBe(0);
  });
});
