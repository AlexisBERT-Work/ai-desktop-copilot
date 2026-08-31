import type { ToolResult } from '@catdesk/shared-types';

/**
 * Assertions de narrowing pour les tests d'outils.
 *
 * `ToolResult` est une union discriminée : après `expect(res.success).toBe(false)`
 * TypeScript ne sait toujours pas qu'on est sur la branche d'échec, car une
 * assertion vitest ne narrow pas. Ces deux helpers le font — et donnent au
 * passage un message d'échec lisible quand le test se trompe de branche.
 */
export function expectOk(result: ToolResult): {
  data?: unknown;
  metadata?: Record<string, unknown>;
} {
  if (!result.success) {
    throw new Error(`Succès attendu, échec reçu : ${result.error}`);
  }
  return result;
}

export function expectFail(result: ToolResult): {
  error: string;
  metadata?: Record<string, unknown>;
} {
  if (result.success) {
    throw new Error(`Échec attendu, succès reçu : ${JSON.stringify(result.data).slice(0, 200)}`);
  }
  return result;
}
