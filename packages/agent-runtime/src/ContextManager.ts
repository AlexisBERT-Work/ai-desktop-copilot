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

  /**
   * Faits durables (mémoire warm), formatés pour le prompt système. Petit jeu
   * structuré, lu en synchrone ; ordre stable (`updated_at`) — il entre dans le
   * prompt système, dont le moindre changement invalide le cache d'Ollama.
   */
  getWarmFacts(): string[] {
    try {
      return this.warmStore?.getActiveFacts(WARM_FACTS_LIMIT).map(f => `- ${f.value}`) ?? [];
    } catch (err) {
      log.warn('Warm facts read failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  async buildContext(conversationId: string, userInput: string): Promise<AgentContext> {
    // If older turns were compacted, load only the messages after the marker
    // and surface the rolling summary instead of the dropped history. Store
    // reads are synchronous: wrapped so a failure degrades to an empty history
    // instead of throwing out of the run (allSettled can't catch a sync throw).
    let summaryRow: { summary: string; throughTs: number } | null = null;
    let messages: OllamaMessage[] = [];
    try {
      summaryRow = this.db.getSummary(conversationId);
      messages = this.db
        .getLatestMessagesSince(
          conversationId,
          summaryRow?.throughTs ?? 0,
          RECENT_MESSAGES_LIMIT * 2,
        )
        .map(m => ({ role: m.role as OllamaMessage['role'], content: m.content }));
    } catch (err) {
      log.warn('History read failed', { error: err instanceof Error ? err.message : String(err) });
    }

    let memories: string[] = [];
    try {
      const hits = await this.vectorStore.search(userInput, { limit: 10, minScore: 0.65 });
      // Les échanges de CETTE conversation sont déjà dans l'historique (ou dans
      // son résumé) : les resservir en « souvenirs » doublait leur coût en
      // tokens à chaque tour.
      memories = hits
        .filter(
          r =>
            !(
              r.metadata?.['kind'] === 'exchange' && r.metadata['conversationId'] === conversationId
            ),
        )
        .slice(0, 5)
        .map(r => r.content);
    } catch (err) {
      log.debug('Semantic recall failed', { error: String(err) });
    }

    const warmFacts = this.getWarmFacts();

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
      this.db.recordExchange(conversationId, model, userText, assistantText);
    } catch (err) {
      log.warn('recordTurn failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Index a completed exchange into the semantic store for cross-conversation
   * recall (the vector layer was never populated before this). Async: embeds via
   * Ollama, so the orchestrator calls it fire-and-forget.
   */
  async rememberExchange(
    conversationId: string,
    userText: string,
    assistantText: string,
  ): Promise<void> {
    const content = `Utilisateur : ${userText.trim()}\nAssistant : ${assistantText.trim()}`.trim();
    if (content.length < 16) return; // nothing worth indexing
    try {
      await this.vectorStore.store(content, { conversationId, kind: 'exchange', ts: Date.now() });
    } catch (err) {
      log.warn('rememberExchange failed', {
        error: err instanceof Error ? err.message : String(err),
      });
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
