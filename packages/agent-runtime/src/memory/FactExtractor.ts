import type { OllamaClient } from '../llm/OllamaClient';
import type { OllamaMessage } from '@catdesk/shared-types';
import type { WarmMemoryStore, WarmFactInput, WarmFactKind } from './WarmMemoryStore';
import { createLogger } from '../logger';

const log = createLogger('memory:extractor');

const EXTRACT_SYSTEM = `Tu extrais des FAITS DURABLES sur l'utilisateur depuis une conversation,
pour une mémoire long terme. Ne retiens que ce qui restera vrai au-delà de cette tâche :
préférences (outils, langages, style), identité, contexte récurrent, conventions.

IGNORE le contenu jetable : détails d'une tâche ponctuelle, questions, contenu de fichiers,
résultats d'outils, politesses.

Réponds UNIQUEMENT par un tableau JSON, sans texte autour. Chaque élément :
{"kind":"preference"|"fact","subject":"<clé courte en snake_case>","value":"<phrase brève>","confidence":0..1}
Si rien de durable, réponds [].

Exemple :
[{"kind":"preference","subject":"editeur_prefere","value":"préfère VS Code","confidence":0.9},
 {"kind":"fact","subject":"stack_principale","value":"développe en Rust et React","confidence":0.8}]`;

/** Max characters of transcript fed to the extractor (keeps the small model fast). */
const MAX_TRANSCRIPT_CHARS = 4000;

/**
 * Single-pass fact extraction (CATDESK-CONCEPTS-AVANCES §3): one cheap call on
 * the small model turns a conversation slice into structured warm facts, instead
 * of re-processing the whole history. Contradiction handling is delegated to
 * WarmMemoryStore.upsert (supersede-by-subject).
 */
export class FactExtractor {
  constructor(
    private llm: OllamaClient,
    private model: string,
    private store: WarmMemoryStore,
  ) {}

  /** Build a compact user/assistant transcript (tool noise stripped). */
  static toTranscript(messages: OllamaMessage[], maxChars = MAX_TRANSCRIPT_CHARS): string {
    const lines: string[] = [];
    for (const m of messages) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const text = (m.content ?? '').trim();
      if (!text) continue;
      lines.push(`${m.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${text}`);
    }
    let transcript = lines.join('\n');
    if (transcript.length > maxChars) transcript = transcript.slice(-maxChars);
    return transcript;
  }

  /** Extract facts, store them, return how many were newly added or changed. */
  async extractAndStore(messages: OllamaMessage[], source?: string): Promise<number> {
    const transcript = FactExtractor.toTranscript(messages);
    if (transcript.length < 20) return 0; // nothing meaningful to mine

    let text = '';
    try {
      const stream = this.llm.streamChat({
        model: this.model,
        system: EXTRACT_SYSTEM,
        messages: [{ role: 'user', content: transcript }],
        temperature: 0,
      });
      for await (const chunk of stream) {
        if (chunk.type === 'token') text += chunk.content;
      }
    } catch (err) {
      log.warn('Extraction call failed', { error: err instanceof Error ? err.message : String(err) });
      return 0;
    }

    const facts = parseFacts(text);
    let changed = 0;
    for (const f of facts) {
      if (this.store.upsert(source ? { ...f, source } : f)) changed++;
    }
    if (facts.length > 0) log.info('Facts extracted', { found: facts.length, changed, source });
    return changed;
  }
}

const VALID_KINDS: ReadonlySet<string> = new Set<WarmFactKind>(['preference', 'fact']);

/**
 * Parse the model's reply into validated fact inputs. Pure & deterministic
 * (testable without an LLM). Tolerates surrounding prose / ``` fences by
 * extracting the first JSON array, and drops malformed entries.
 */
export function parseFacts(text: string): WarmFactInput[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: WarmFactInput[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const kind = rec['kind'];
    const subject = rec['subject'];
    const value = rec['value'];
    if (!VALID_KINDS.has(kind as string)) continue;
    if (typeof subject !== 'string' || typeof value !== 'string') continue;
    if (!subject.trim() || !value.trim()) continue;
    const confidence = typeof rec['confidence'] === 'number' ? clamp01(rec['confidence']) : 0.7;
    out.push({ kind: kind as WarmFactKind, subject, value, confidence });
  }
  return out;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.7;
  return Math.min(1, Math.max(0, n));
}
