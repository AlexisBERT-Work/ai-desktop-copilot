import type { ConversationStore } from './ConversationStore';
import type { ConversationSummarizer } from './ConversationSummarizer';
import { createLogger } from '../logger';

const log = createLogger('memory:compactor');

export interface CompactorOptions {
  /** Compact once a conversation has more than this many un-summarized messages. */
  threshold?: number;
  /** Always leave this many most-recent messages verbatim (not folded into the summary). */
  keepRecent?: number;
}

/**
 * Conversation compaction (CATDESK-CONCEPTS-AVANCES §2A): when the un-summarized
 * tail of a conversation grows past a threshold, fold its older part into the
 * rolling summary and advance the marker. The recent messages stay verbatim, so
 * the model keeps both a high-level summary and the live thread — instead of the
 * old behavior of silently dropping anything past the char budget.
 */
export class Compactor {
  private readonly threshold: number;
  private readonly keepRecent: number;

  constructor(
    private store: ConversationStore,
    private summarizer: ConversationSummarizer,
    opts: CompactorOptions = {},
  ) {
    this.threshold = opts.threshold ?? 16;
    this.keepRecent = opts.keepRecent ?? 6;
  }

  /** Compact if needed. Returns whether it summarized and how many messages it folded. */
  async maybeCompact(conversationId: string): Promise<{ compacted: boolean; folded: number }> {
    const prior = this.store.getSummary(conversationId);
    const sinceTs = prior?.throughTs ?? 0;
    const msgs = this.store.getMessagesSince(conversationId, sinceTs, 500);
    if (msgs.length <= this.threshold) return { compacted: false, folded: 0 };

    const toFold = msgs.slice(0, msgs.length - this.keepRecent);
    if (toFold.length === 0) return { compacted: false, folded: 0 };
    const throughTs = toFold[toFold.length - 1]!.createdAt;

    const summary = await this.summarizer.summarize(toFold, prior?.summary);
    if (!summary.trim()) return { compacted: false, folded: 0 };

    this.store.setSummary(conversationId, summary, throughTs);
    log.info('Conversation compacted', { conversationId, folded: toFold.length, throughTs });
    return { compacted: true, folded: toFold.length };
  }
}
