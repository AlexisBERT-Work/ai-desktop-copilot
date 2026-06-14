import { describe, it, expect } from 'vitest';
import { ConversationSummarizer } from './ConversationSummarizer';

function fakeLlm(reply: string) {
  return {
    async *streamChat() {
      yield { type: 'token' as const, content: reply };
    },
  };
}

describe('ConversationSummarizer.toTranscript', () => {
  it('labels roles and skips empties', () => {
    const t = ConversationSummarizer.toTranscript([
      { role: 'user', content: 'salut' },
      { role: 'assistant', content: '' },
      { role: 'assistant', content: 'bonjour' },
    ]);
    expect(t).toBe('Utilisateur: salut\nAssistant: bonjour');
  });

  it('caps to the tail when too long', () => {
    const t = ConversationSummarizer.toTranscript([{ role: 'user', content: 'x'.repeat(100) }], 20);
    expect(t.length).toBeLessThanOrEqual(20);
  });
});

describe('ConversationSummarizer.summarize', () => {
  it('returns the model summary', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = new ConversationSummarizer(fakeLlm('Résumé dense.') as any, 'm');
    const out = await s.summarize([{ role: 'user', content: 'je code en Rust' }]);
    expect(out).toBe('Résumé dense.');
  });

  it('keeps the prior summary when there is nothing new', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = new ConversationSummarizer(fakeLlm('ignored') as any, 'm');
    const out = await s.summarize([], 'ANCIEN');
    expect(out).toBe('ANCIEN');
  });

  it('falls back to the prior summary on an empty model reply', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = new ConversationSummarizer(fakeLlm('   ') as any, 'm');
    const out = await s.summarize([{ role: 'user', content: 'x' }], 'ANCIEN');
    expect(out).toBe('ANCIEN');
  });
});
