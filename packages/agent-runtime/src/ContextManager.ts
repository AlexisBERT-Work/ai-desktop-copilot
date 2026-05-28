import type { OllamaMessage } from '@neurodesk/shared-types';
import type { ConversationStore } from './memory/ConversationStore';
import type { VectorStore } from './memory/VectorStore';
import { createLogger } from './logger';

const log = createLogger('agent:context');

const MAX_CONTEXT_CHARS = 12_000; // ~3000 tokens rough estimate
const RECENT_MESSAGES_LIMIT = 20;

export interface AgentContext {
  messages: OllamaMessage[];
  activeWindow?: string;
  screenText?: string;
  relevantMemories?: string[];
}

export class ContextManager {
  constructor(
    private db: ConversationStore,
    private vectorStore: VectorStore,
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

    // Trim messages to fit context budget
    const trimmed = this.trimMessages(messages, MAX_CONTEXT_CHARS);

    log.debug('Context built', {
      conversationId,
      messageCount: trimmed.length,
      memoryCount: memories.length,
    });

    return {
      messages: trimmed,
      relevantMemories: memories.length > 0 ? memories : undefined,
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
