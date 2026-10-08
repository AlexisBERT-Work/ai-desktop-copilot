import type { OllamaClient } from '../llm/OllamaClient';
import { createLogger } from '../logger';
import { complete } from '../llm/completion';

const log = createLogger('memory:summarizer');

const SYSTEM = `Tu maintiens un RÉSUMÉ courant d'une conversation, pour préserver le contexte
quand l'historique devient trop long. Intègre le résumé précédent (s'il existe) avec les
nouveaux échanges en UN seul résumé cohérent.

Garde : décisions prises, faits et préférences de l'utilisateur, tâches en cours, fils non
résolus. Jette : politesses, détails jetables. Écris à la 3e personne, en français, de façon
dense (≈120 mots max). Réponds UNIQUEMENT par le résumé, sans préambule.`;

const MAX_TRANSCRIPT_CHARS = 6000;

export interface SummarizableMessage {
  role: string;
  content: string;
}

/**
 * Rolling conversation summary (CATDESK-CONCEPTS-AVANCES §2A "compaction").
 * Folds a batch of older messages (plus any prior summary) into one compact
 * summary so long sessions keep their context without blowing the token budget.
 */
export class ConversationSummarizer {
  constructor(
    private llm: OllamaClient,
    private model: string,
  ) {}

  static toTranscript(messages: SummarizableMessage[], maxChars = MAX_TRANSCRIPT_CHARS): string {
    const lines: string[] = [];
    for (const m of messages) {
      const text = (m.content ?? '').trim();
      if (!text) continue;
      const who = m.role === 'user' ? 'Utilisateur' : m.role === 'assistant' ? 'Assistant' : m.role;
      lines.push(`${who}: ${text}`);
    }
    let t = lines.join('\n');
    if (t.length > maxChars) t = t.slice(-maxChars);
    return t;
  }

  /**
   * Produce an updated summary from a prior summary + a batch of messages.
   * `null` = pas de résumé exploitable (appel en échec, réponse vide) : l'appelant
   * ne doit RIEN enregistrer. Rendre l'ancien résumé à la place faisait avancer
   * le marqueur de compaction — les messages repliés disparaissaient du contexte
   * sans avoir été résumés.
   */
  async summarize(messages: SummarizableMessage[], prior?: string): Promise<string | null> {
    const transcript = ConversationSummarizer.toTranscript(messages);
    if (!transcript) return prior ?? '';

    const userContent =
      (prior ? `Résumé précédent :\n${prior}\n\n` : '') +
      `Nouveaux échanges à intégrer :\n${transcript}`;

    let text: string;
    try {
      // think:false — tâche de fond : le raisonnement caché de qwen3 ne ferait
      // qu'occuper le GPU plus longtemps, sans meilleur résumé. background :
      // cède le GPU à l'utilisateur (LlmScheduler).
      text = await complete(this.llm, this.model, SYSTEM, userContent, {
        temperature: 0.2,
        think: false,
        background: true,
      });
    } catch (err) {
      log.warn('Summarize call failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    return text.trim() || null;
  }
}
