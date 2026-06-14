import { describe, it, expect } from 'vitest';
import { recoverToolCalls, looksLikeToolCallStart } from './recoverToolCalls';

const known = new Set(['run_subagent', 'list_scheduled_tasks', 'schedule_task']);

describe('recoverToolCalls', () => {
  it('recovers a bare JSON tool call', () => {
    const text = '{ "name": "list_scheduled_tasks", "arguments": {} }';
    const { calls, cleanedText } = recoverToolCalls(text, known);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('list_scheduled_tasks');
    expect(calls[0]?.args).toEqual({});
    expect(cleanedText).toBe('');
  });

  it('recovers a <tool_call> tagged call with args', () => {
    const text = '<tool_call>{"name":"schedule_task","arguments":{"task":"news","schedule":"daily"}}</tool_call>';
    const { calls } = recoverToolCalls(text, known);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('schedule_task');
    expect(calls[0]?.args).toEqual({ task: 'news', schedule: 'daily' });
  });

  it('recovers from a ```json fence', () => {
    const text = 'Voici:\n```json\n{"name":"run_subagent","arguments":{"task":"x"}}\n```';
    const { calls } = recoverToolCalls(text, known);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('run_subagent');
  });

  it('parses stringified arguments', () => {
    const text = '{"name":"schedule_task","arguments":"{\\"task\\":\\"y\\",\\"schedule\\":\\"hourly\\"}"}';
    const { calls } = recoverToolCalls(text, known);
    expect(calls[0]?.args).toEqual({ task: 'y', schedule: 'hourly' });
  });

  it('ignores JSON whose name is not a known tool', () => {
    const text = '{ "name": "not_a_tool", "arguments": {} }';
    const { calls } = recoverToolCalls(text, known);
    expect(calls).toHaveLength(0);
  });

  it('leaves a normal prose answer untouched', () => {
    const text = 'Tu as actuellement 0 tâche planifiée.';
    const { calls, cleanedText } = recoverToolCalls(text, known);
    expect(calls).toHaveLength(0);
    expect(cleanedText).toBe(text);
  });

  it('deduplicates identical calls', () => {
    const text = '<tool_call>{"name":"run_subagent","arguments":{"task":"x"}}</tool_call>'
      + '<tool_call>{"name":"run_subagent","arguments":{"task":"x"}}</tool_call>';
    const { calls } = recoverToolCalls(text, known);
    expect(calls).toHaveLength(1);
  });
});

describe('looksLikeToolCallStart', () => {
  it('flags JSON / tag openings', () => {
    expect(looksLikeToolCallStart('{ "name"')).toBe(true);
    expect(looksLikeToolCallStart('  <tool_call>')).toBe(true);
    expect(looksLikeToolCallStart('[')).toBe(true);
  });
  it('does not flag prose', () => {
    expect(looksLikeToolCallStart('Bonjour, voici')).toBe(false);
    expect(looksLikeToolCallStart('Tu as 0 tâche')).toBe(false);
  });
});
