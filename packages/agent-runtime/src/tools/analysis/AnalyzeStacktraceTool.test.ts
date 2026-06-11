import { describe, it, expect } from 'vitest';
import { AnalyzeStacktraceTool } from './AnalyzeStacktraceTool';

const tool = new AnalyzeStacktraceTool();

/** Helper : exécute et renvoie data typé librement. */
async function analyze(stacktrace: string, context?: string): Promise<any> {
  const res = await tool.execute({ stacktrace, ...(context ? { context } : {}) });
  expect(res.success).toBe(true);
  return res.data;
}

describe('AnalyzeStacktraceTool', () => {
  it('rejette une stacktrace vide', async () => {
    const res = await tool.execute({ stacktrace: '   ' });
    expect(res.success).toBe(false);
  });

  it('analyse une stacktrace Node.js et trouve la frame utilisateur comme cause', async () => {
    const trace = [
      "TypeError: Cannot read properties of undefined (reading 'foo')",
      '    at myFunc (C:\\app\\src\\index.js:10:15)',
      '    at Object.<anonymous> (C:\\app\\node_modules\\lib\\x.js:5:3)',
      '    at node:internal/main/run_main:23:11',
    ].join('\n');

    const data = await analyze(trace);
    expect(data.language).toBe('nodejs');
    expect(data.errorType).toBe('TypeError');
    expect(data.errorMessage).toContain('Cannot read properties');
    expect(data.totalFrames).toBe(3);
    // node_modules + node:internal => internes ; seule index.js est utilisateur
    expect(data.userFrames).toHaveLength(1);
    expect(data.rootCauseFrame.functionName).toBe('myFunc');
    expect(data.rootCauseFrame.file).toContain('index.js');
  });

  it('détecte le TypeScript', async () => {
    const trace = ['Error: boom', '    at run (/app/src/main.ts:3:9)'].join('\n');
    const data = await analyze(trace);
    expect(data.language).toBe('typescript');
    expect(data.errorType).toBe('Error');
    expect(data.rootCauseFrame.functionName).toBe('run');
  });

  it('analyse un Traceback Python (cause = frame la plus interne)', async () => {
    const trace = [
      'Traceback (most recent call last):',
      '  File "/app/main.py", line 12, in <module>',
      '    do_thing()',
      '  File "/app/worker.py", line 5, in do_thing',
      '    raise ValueError("bad value")',
      'ValueError: bad value',
    ].join('\n');

    const data = await analyze(trace);
    expect(data.language).toBe('python');
    expect(data.errorType).toBe('ValueError');
    expect(data.errorMessage).toBe('bad value');
    expect(data.totalFrames).toBe(2);
    expect(data.rootCauseFrame.functionName).toBe('do_thing');
    expect(data.rootCauseFrame.line).toBe(5);
  });

  it('analyse un panic Rust', async () => {
    const trace = [
      "thread 'main' panicked at 'index out of bounds: the len is 0', src/main.rs:10:5",
      '   0: my_app::run',
      '   1: core::ops::function::FnOnce',
    ].join('\n');

    const data = await analyze(trace);
    expect(data.language).toBe('rust');
    expect(data.errorType).toBe('panic');
    expect(data.errorMessage).toContain('index out of bounds');
  });

  it('analyse une exception Java', async () => {
    const trace = [
      'java.lang.NullPointerException: Attempt to invoke method on null',
      '    at com.example.App.main(App.java:23)',
      '    at com.example.Helper.help(Helper.java:10)',
    ].join('\n');

    const data = await analyze(trace);
    expect(data.language).toBe('java');
    expect(data.errorType).toBe('java.lang.NullPointerException');
    expect(data.rootCauseFrame.functionName).toBe('com.example.App.main');
  });

  it('inclut le contexte fourni', async () => {
    const data = await analyze('Error: x\n    at f (/a.js:1:1)', 'pendant le build');
    expect(data.context).toBe('pendant le build');
  });
});
