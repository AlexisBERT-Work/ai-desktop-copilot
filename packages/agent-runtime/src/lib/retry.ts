/**
 * Réessaie une opération asynchrone avec un backoff linéaire court.
 * Pensé pour les appels réseau locaux (Ollama) où un échec transitoire
 * (modèle en cours de chargement, service qui redémarre) est fréquent.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; delayMs?: number } = {},
): Promise<T> {
  const { retries = 1, delayMs = 300 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}
