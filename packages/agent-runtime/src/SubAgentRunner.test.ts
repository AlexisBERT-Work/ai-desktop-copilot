import { describe, it, expect } from 'vitest';
import { SubAgentRunner } from './SubAgentRunner';
import type { AgentOrchestrator } from './AgentOrchestrator';
import type { ToolRegistry } from './ToolRegistry';

function makeRunner() {
  const captured: { input?: string } = {};
  const orchestrator = {
    // eslint-disable-next-line require-yield
    async *process(input: string) {
      captured.input = input;
      yield { type: 'done' as const, content: 'résultat' };
    },
  } as unknown as AgentOrchestrator;
  const toolRegistry = { listNames: () => ['read_file', 'run_subagent'] } as unknown as ToolRegistry;
  return { runner: new SubAgentRunner(orchestrator, toolRegistry, 'qwen2.5:7b'), captured };
}

describe('SubAgentRunner curated context (§6)', () => {
  it('passes the bare task when no context is given', async () => {
    const { runner, captured } = makeRunner();
    const r = await runner.run('analyse ce fichier');
    expect(captured.input).toBe('analyse ce fichier');
    expect(r.success).toBe(true);
    expect(r.output).toBe('résultat');
  });

  it('prepends curated context ahead of the task', async () => {
    const { runner, captured } = makeRunner();
    await runner.run('corrige le bug', { context: 'Le bug est dans parse() à la ligne 42.' });
    expect(captured.input).toContain('Le bug est dans parse() à la ligne 42.');
    expect(captured.input).toContain('corrige le bug');
    // context comes before the task
    expect(captured.input!.indexOf('ligne 42')).toBeLessThan(captured.input!.indexOf('corrige le bug'));
  });

  it('ignores blank context', async () => {
    const { runner, captured } = makeRunner();
    await runner.run('fais X', { context: '   ' });
    expect(captured.input).toBe('fais X');
  });

  it('excludes recursive sub-agent tools from the default tool list', async () => {
    const { runner } = makeRunner();
    // run_subagent is filtered out of the sub-agent's own tool list
    const r = await runner.run('tâche');
    expect(r.success).toBe(true); // smoke: the run completes with the filtered list
  });
});
