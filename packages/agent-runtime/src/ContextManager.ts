import type { OllamaMessage } from '@catdesk/shared-types';
import type { ConversationStore } from './memory/ConversationStore';
import type { VectorStore } from './memory/VectorStore';
import type { WarmMemoryStore } from './memory/WarmMemoryStore';
import { createLogger } from './logger';

const log = createLogger('agent:context');

const MAX_CONTEXT_CHARS = 12_000; // ~3000 tokens rough estimate
const RECENT_MESSAGES_LIMIT = 20;
const WARM_FACTS_LIMIT = 20;

export interface AgentContext {
  messages: OllamaMessage[];
  activeWindow?: string;
  screenText?: string;
  relevantMemories?: string[];
  /** Durable user facts/preferences from the warm memory layer. */
  warmFacts?: string[];
}

export class ContextManager {
  constructor(
    private db: ConversationStore,
    private vectorStore: VectorStore,
    private warmStore?: WarmMemoryStore,
  ) {}

  async buildContext(conversationId: string, userInput: string): Promise<AgentContext> {
    const [recentMessages, relevantMemories] = await Promise.allSettled([
      this.db.getRecentMessages(conversationId, RECENT_MESSAGES_LIMIT),
      this.vectorStore.search(userInput, { limit: 5, minScore: 0.65 }),
    ]);

    const messages: OllamaMessage[] =
      recentMessages.status === 'fulfilled' ? recentMessages.value : [];

    const memories: string[] =
      relevantMemories.status === 'fulfilled'
        ? relevantMemories.value.map(r => r.content)
        : [];

    // Warm facts are a tiny, instantly-queryable structured set — read synchronously.
    let warmFacts: string[] = [];
    try {
      warmFacts = this.warmStore?.getActiveFacts(WARM_FACTS_LIMIT).map(f => `- ${f.value}`) ?? [];
    } catch (err) {
      log.warn('Warm facts read failed', { error: err instanceof Error ? err.message : String(err) });
    }

    // Trim messages to fit context budget
    const trimmed = this.trimMessages(messages, MAX_CONTEXT_CHARS);

    log.debug('Context built', {
      conversationId,
      messageCount: trimmed.length,
      memoryCount: memories.length,
      warmFactCount: warmFacts.length,
    });

    return {
      messages: trimmed,
      ...(memories.length > 0 ? { relevantMemories: memories } : {}),
      ...(warmFacts.length > 0 ? { warmFacts } : {}),
    };
  }

  private trimMessages(messages: OllamaMessage[], maxChars: number): OllamaMessage[] {
    let totalChars = 0;
    const result: OllamaMessage[] = [];

    // Walk from most recent backwards
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;
      const chars = msg.content.length;
      if (totalChars + chars > maxChars) break;
      totalChars += chars;
      result.unshift(msg);
    }

    return result;
  }
}
