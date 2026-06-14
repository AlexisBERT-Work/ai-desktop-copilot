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
  /** Rolling summary of the older part of the conversation (compaction). */
  conversationSummary?: string;
}

export class ContextManager {
  constructor(
    private db: ConversationStore,
    private vectorStore: VectorStore,
    private warmStore?: WarmMemoryStore,
  ) {}

  async buildContext(conversationId: string, userInput: string): Promise<AgentContext> {
    // If older turns were compacted, load only the messages after the marker
    // and surface the rolling summary instead of the dropped history.
    const summaryRow = this.db.getSummary(conversationId);
    const sinceTs = summaryRow?.throughTs ?? 0;

    const [recentMessages, relevantMemories] = await Promise.allSettled([
      Promise.resolve(this.db.getMessagesSince(conversationId, sinceTs, RECENT_MESSAGES_LIMIT * 2)),
      this.vectorStore.search(userInput, { limit: 5, minScore: 0.65 }),
    ]);

    const messages: OllamaMessage[] =
      recentMessages.status === 'fulfilled'
        ? recentMessages.value.map(m => ({ role: m.role as OllamaMessage['role'], content: m.content }))
        : [];

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
      ...(summaryRow?.summary ? { conversationSummary: summaryRow.summary } : {}),
    };
  }

  /**
   * Persist a completed exchange so the next turn has conversational memory.
   * Until this was wired, messages were never stored and every turn started
   * blind (only warm facts + vector memories survived). Best-effort: never
   * throws into the run path.
   */
  recordTurn(conversationId: string, model: string, userText: string, assistantText: string): void {
    try {
      this.db.createConversation(conversationId, model);
      if (userText.trim()) {
        this.db.addMessage(conversationId, { id: crypto.randomUUID(), role: 'user', content: userText });
      }
      if (assistantText.trim()) {
        this.db.addMessage(conversationId, { id: crypto.randomUUID(), role: 'assistant', content: assistantText });
      }
    } catch (err) {
      log.warn('recordTurn failed', { error: err instanceof Error ? err.message : String(err) });
    }
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
