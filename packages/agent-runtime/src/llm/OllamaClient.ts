import type { OllamaMessage, OllamaToolSchema, StreamChunk } from '@catdesk/shared-types';
import { createLogger } from '../logger';
import { CONFIG } from '../config';
import { withRetry } from '../lib/retry';

const log = createLogger('llm:ollama');

/**
 * Ollama expects `tool_calls[].function.arguments` as an OBJECT in request
 * messages. A JSON string causes a 400 ("Value looks like object, but can't
 * find closing '}' symbol"). Normalise any stringified arguments back to an
 * object before sending.
 */
function normalizeToolCallArgs(m: OllamaMessage): OllamaMessage {
  if (!m.tool_calls?.length) return m;
  return {
    ...m,
    tool_calls: m.tool_calls.map(tc => {
      const args = tc.function.arguments;
      if (typeof args !== 'string') return tc;
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(args) as Record<string, unknown>;
      } catch {
        /* keep {} */
      }
      return { ...tc, function: { ...tc.function, arguments: parsed } };
    }),
  };
}

/** Une ligne NDJSON de /api/chat, telle qu'Ollama la stream. */
interface ChatLine {
  message?: {
    content?: string;
    tool_calls?: Array<{ id?: string; function: { name: string; arguments: unknown } }>;
  };
  done?: boolean;
  eval_count?: number;
}

/**
 * Traduit une ligne NDJSON du flux /api/chat en chunks. Pur, exporté pour les
 * tests : c'est le code le plus « parsing » du runtime. Une ligne illisible
 * (coupée, bruit) ne produit rien plutôt que de casser le flux. Les arguments
 * d'outil restent tels qu'Ollama les donne (un OBJET) — l'orchestrateur sait
 * lire une chaîne JSON aussi, sans aller-retour inutile.
 */
export function parseChatLine(line: string): StreamChunk[] {
  if (!line.trim()) return [];
  let data: ChatLine;
  try {
    data = JSON.parse(line) as ChatLine;
  } catch {
    return [];
  }
  const chunks: StreamChunk[] = [];
  if (data.message?.content) chunks.push({ type: 'token', content: data.message.content });
  for (const tc of data.message?.tool_calls ?? []) {
    const args = tc.function.arguments;
    chunks.push({
      type: 'tool_call',
      toolCall: {
        id: tc.id ?? crypto.randomUUID(),
        type: 'function',
        function: {
          name: tc.function.name,
          arguments:
            typeof args === 'string' || (args !== null && typeof args === 'object')
              ? (args as string | Record<string, unknown>)
              : {},
        },
      },
    });
  }
  if (data.done) chunks.push({ type: 'done', totalTokens: data.eval_count ?? 0 });
  return chunks;
}

export interface OllamaConfig {
  baseUrl: string;
  defaultModel?: string;
  requestTimeout?: number;
  /**
   * Durée pendant laquelle Ollama garde le modèle chargé en RAM après une
   * requête (ex. '10m', '1h', '-1' = jamais décharger, '0' = décharger aussitôt).
   * Garder le modèle chaud évite un rechargement coûteux à chaque appel.
   */
  keepAlive?: string;
}

export interface ChatParams {
  model: string;
  messages: OllamaMessage[];
  tools?: OllamaToolSchema[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** Surcharge ponctuelle du keep_alive (voir OllamaConfig.keepAlive). */
  keepAlive?: string;
  /** Taille de la fenêtre de contexte (num_ctx). Plus petit = moins de RAM. */
  numCtx?: number;
  /**
   * Délai max de la requête ENTIÈRE, streaming compris (défaut : requestTimeout
   * de la config, sinon 120 s). Les tâches de fond (digests) passent un budget
   * large : une longue génération n'est pas une panne.
   */
  timeoutMs?: number;
  /**
   * Mode raisonnement des modèles qui en ont un (qwen3…) : false le coupe —
   * indispensable pour les sorties JSON strictes et la latence des digests.
   * Ollama ignore/tolère le champ sur les modèles sans raisonnement.
   */
  think?: boolean;
  /** Signal d'abandon : interrompt la génération en cours (bouton Stop). */
  signal?: AbortSignal;
}

export class OllamaClient {
  constructor(private config: OllamaConfig) {}

  async *streamChat(params: ChatParams): AsyncGenerator<StreamChunk> {
    const url = `${this.config.baseUrl}/api/chat`;

    // keep_alive : garde le modèle chaud en RAM entre les requêtes (gain latence).
    const keepAlive = params.keepAlive ?? this.config.keepAlive ?? '10m';

    const body = {
      model: params.model,
      messages: [
        ...(params.system ? [{ role: 'system', content: params.system }] : []),
        ...params.messages.map(normalizeToolCallArgs),
      ],
      stream: true,
      tools: params.tools,
      keep_alive: keepAlive,
      ...(params.think !== undefined ? { think: params.think } : {}),
      options: {
        temperature: params.temperature ?? 0.7,
        ...(params.maxTokens ? { num_predict: params.maxTokens } : {}),
        ...(params.numCtx ? { num_ctx: params.numCtx } : {}),
      },
    };

    log.debug('Chat request', {
      model: params.model,
      messageCount: body.messages.length,
      keepAlive,
    });

    // Abort on either the request timeout or the caller's signal (Stop button).
    const timeoutSignal = AbortSignal.timeout(
      params.timeoutMs ?? this.config.requestTimeout ?? 120_000,
    );
    const signal = params.signal ? AbortSignal.any([timeoutSignal, params.signal]) : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (params.signal?.aborted) {
        return;
      } // interrupted by the user — stay silent
      const error = err instanceof Error ? err.message : 'Network error';
      log.error('Ollama connection failed', { error, url });
      yield {
        type: 'error',
        error: `Ollama non disponible: ${error}. Assurez-vous qu'Ollama tourne (${this.config.baseUrl}).`,
      };
      return;
    }

    if (!response.ok) {
      const text = await response.text();
      yield { type: 'error', error: `Ollama error ${response.status}: ${text}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (params.signal?.aborted) return; // Stop pressed — stop streaming silently
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          for (const chunk of parseChatLine(line)) {
            yield chunk;
            if (chunk.type === 'done') return;
          }
        }
      }
    } catch (err) {
      // An abort (Stop button / timeout) rejects reader.read(); stay silent so
      // the run ends cleanly instead of surfacing a scary error.
      if (!params.signal?.aborted) {
        yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
      }
    } finally {
      reader.releaseLock();
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Décharge immédiatement un modèle de la VRAM/RAM (mode passif). Ollama
   * libère le modèle quand on lui envoie `keep_alive: 0` sans prompt. Best-effort :
   * ne lève jamais — si Ollama est absent ou le modèle déjà déchargé, on ignore.
   */
  async unload(model: string): Promise<void> {
    try {
      await fetch(`${this.config.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: 0 }),
        signal: AbortSignal.timeout(5000),
      });
      log.info('Model unloaded (passive mode)', { model });
    } catch (err) {
      log.debug('Unload failed (ignored)', {
        model,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Embedding avec timeout + un retry court : sans timeout, un Ollama qui ne
   * répond pas gelait tout le pipeline embeddings (vector store, cache
   * sémantique). Les appelants gèrent l'échec par un repli mots-clés.
   */
  async embed(text: string, model = CONFIG.embedModel): Promise<number[]> {
    return withRetry(
      async () => {
        const response = await fetch(`${this.config.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: text }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) throw new Error(`Embedding failed: ${response.statusText}`);
        const data = (await response.json()) as { embedding: number[] };
        return data.embedding;
      },
      { retries: 1, delayMs: 300 },
    );
  }
}
