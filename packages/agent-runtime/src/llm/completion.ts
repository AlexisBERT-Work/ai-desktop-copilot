import type { OllamaClient } from './OllamaClient';

// Plomberie LLM générique : accumuler une complétion, et récupérer le JSON
// d'une réponse de modèle. Vit sous llm/ et non sous news/ : rien ici ne
// connaît la presse, et NewsSummarizer (llm/) en dépend aussi.

/** Accumule une complétion non-streamée. */
export async function complete(
  llm: OllamaClient,
  model: string,
  system: string,
  user: string,
  opts: { numCtx?: number; timeoutMs?: number; temperature?: number; think?: boolean } = {},
): Promise<string> {
  let text = '';
  const stream = llm.streamChat({
    model,
    system,
    messages: [{ role: 'user', content: user }],
    temperature: opts.temperature ?? 0.3,
    ...(opts.numCtx !== undefined ? { numCtx: opts.numCtx } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.think !== undefined ? { think: opts.think } : {}),
  });
  for await (const chunk of stream) {
    if (chunk.type === 'token') text += chunk.content;
    else if (chunk.type === 'error') throw new Error(chunk.error);
  }
  return text;
}

/**
 * Extrait le premier objet JSON d'une réponse LLM et le renvoie en
 * `Record<string, unknown>`, ou `null` si rien d'exploitable.
 *
 * Les modèles encadrent volontiers leur JSON de prose ou de blocs ```json ; on
 * découpe donc du premier `{` au dernier `}` plutôt que de parser le texte
 * entier. Ce préambule était recopié à l'identique dans cinq modules.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Variante tableau : premier `[` au dernier `]`. Même motif, même tolérance. */
export function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
