import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FactExtractor, parseFacts } from './FactExtractor';
import { WarmMemoryStore } from './WarmMemoryStore';
import type { OllamaMessage } from '@catdesk/shared-types';

/** Minimal OllamaClient stub whose streamChat emits a fixed reply as tokens. */
function fakeLlm(reply: string) {
  return {
    async *streamChat() {
      // split into a couple of chunks to exercise accumulation
      yield { type: 'token' as const, content: reply.slice(0, reply.length / 2) };
      yield { type: 'token' as const, content: reply.slice(reply.length / 2) };
    },
  };
}

describe('parseFacts', () => {
  it('parses a clean JSON array', () => {
    const out = parseFacts(
      '[{"kind":"preference","subject":"editeur","value":"VS Code","confidence":0.9}]',
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'preference',
      subject: 'editeur',
      value: 'VS Code',
      confidence: 0.9,
    });
  });

  it('extracts the array from surrounding prose / fences', () => {
    const out = parseFacts(
      'Voici les faits:\n```json\n[{"kind":"fact","subject":"s","value":"v"}]\n```\nVoilà.',
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.confidence).toBe(0.7); // default when missing
  });

  it('drops entries with invalid kind or missing fields', () => {
    const out = parseFacts(
      '[{"kind":"random","subject":"a","value":"b"},{"kind":"fact","subject":"a"},{"kind":"fact","subject":"ok","value":"y"}]',
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.subject).toBe('ok');
  });

  it('clamps confidence to [0,1]', () => {
    const out = parseFacts('[{"kind":"fact","subject":"a","value":"b","confidence":5}]');
    expect(out[0]?.confidence).toBe(1);
  });

  it('returns [] on non-array or garbage', () => {
    expect(parseFacts('no json here')).toEqual([]);
    expect(parseFacts('{"kind":"fact"}')).toEqual([]);
    expect(parseFacts('[broken')).toEqual([]);
  });
});

describe('FactExtractor.toTranscript', () => {
  it('keeps user/assistant text and strips tool noise', () => {
    const msgs: OllamaMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'salut' },
      { role: 'tool', content: 'tool output' },
      { role: 'assistant', content: 'bonjour' },
    ];
    const t = FactExtractor.toTranscript(msgs);
    expect(t).toContain('Utilisateur: salut');
    expect(t).toContain('Assistant: bonjour');
    expect(t).not.toContain('tool output');
    expect(t).not.toContain('sys');
  });

  it('caps to the tail when too long', () => {
    const msgs: OllamaMessage[] = [{ role: 'user', content: 'x'.repeat(100) }];
    expect(FactExtractor.toTranscript(msgs, 30).length).toBeLessThanOrEqual(30);
  });
});

describe('FactExtractor.extractAndStore', () => {
  let dir: string;
  let store: WarmMemoryStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ndfx-test-'));
    store = new WarmMemoryStore(dir);
    await store.initialize();
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('extracts facts from the reply and stores them', async () => {
    const reply = '[{"kind":"preference","subject":"editeur","value":"VS Code","confidence":0.9}]';

    const fx = new FactExtractor(fakeLlm(reply) as any, 'm', store);
    const msgs: OllamaMessage[] = [{ role: 'user', content: 'je code tout le temps dans VS Code' }];
    const changed = await fx.extractAndStore(msgs, 'conv-1');
    expect(changed).toBe(1);
    expect(store.getActiveFacts()[0]?.value).toBe('VS Code');
    expect(store.getActiveFacts()[0]?.source).toBe('conv-1');
  });

  it('skips an empty transcript without calling the model', async () => {
    const streamChat = vi.fn();

    const fx = new FactExtractor({ streamChat } as any, 'm', store);
    const changed = await fx.extractAndStore([{ role: 'tool', content: 'x' }]);
    expect(changed).toBe(0);
    expect(streamChat).not.toHaveBeenCalled();
  });

  it('returns 0 and stores nothing when the model emits no facts', async () => {
    const fx = new FactExtractor(fakeLlm('[]') as any, 'm', store);
    const changed = await fx.extractAndStore([{ role: 'user', content: 'quelle heure est-il ?' }]);
    expect(changed).toBe(0);
    expect(store.count()).toBe(0);
  });
});
