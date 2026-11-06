import { describe, expect, it } from 'vitest';
import type { StreamChunk } from '@catdesk/shared-types';
import type { OllamaClient } from './OllamaClient';
import { complete } from './completion';
import { LlmScheduler } from './LlmScheduler';

/** Faux client : stream `chunks`, se tait sur interruption comme le vrai. */
function fakeLlm(chunks: StreamChunk[], scheduler?: LlmScheduler) {
  return {
    scheduler,
    async *streamChat(params: { signal?: AbortSignal }) {
      for (const c of chunks) {
        await new Promise(r => setTimeout(r, 5));
        if (params.signal?.aborted) return;
        yield c;
      }
    },
  } as unknown as OllamaClient;
}

const tok = (content: string): StreamChunk => ({ type: 'token', content });

describe('complete', () => {
  it('accumule les tokens', async () => {
    await expect(complete(fakeLlm([tok('a'), tok('b')]), 'm', 's', 'u')).resolves.toBe('ab');
  });

  it('lève sur interruption au lieu de rendre un texte partiel (un résumé tronqué serait enregistré)', async () => {
    const controller = new AbortController();
    const pending = complete(fakeLlm([tok('a'), tok('b'), tok('c')]), 'm', 's', 'u', {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 7);
    await expect(pending).rejects.toThrow('interrompue');
  });

  it('background : cède au premier plan puis reprend, résultat complet', async () => {
    const scheduler = new LlmScheduler({ quietMs: 10, pollMs: 2 });
    const llm = fakeLlm([tok('a'), tok('b'), tok('c')], scheduler);
    const pending = complete(llm, 'm', 's', 'u', { background: true });
    setTimeout(() => {
      scheduler.beginForeground();
      setTimeout(() => scheduler.endForeground(), 5);
    }, 7);
    await expect(pending).resolves.toBe('abc');
  });
});
