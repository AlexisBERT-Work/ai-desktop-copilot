// La plomberie générique (complete, extraction JSON) vit dans llm/completion ;
// `complete` est réexporté ici parce que tout le pipeline presse l'appelle avec
// DIGEST_LLM_OPTS et importe déjà ce module.
export { complete, extractJsonArray, extractJsonObject } from '../llm/completion';

/**
 * Plomberie LLM partagée des digests de presse (journaux, sujets, synthèse) :
 * budget de contexte, délais, options communes et complétion non-streamée.
 */

/**
 * Budget de caractères de texte par article dans l'invite : vise ~12 000
 * caractères au total (≈3 500 tokens — tient dans DIGEST_NUM_CTX avec la
 * réponse), borné entre 600 et 1 500 par article. Pur, exporté pour tests.
 */
export function articleCharBudget(count: number): number {
  if (count <= 0) return 1500;
  return Math.max(600, Math.min(1500, Math.floor(12_000 / count)));
}

/**
 * Fenêtre de contexte des appels de digest : les invites incluent le corps des
 * articles (~12 k caractères) — la fenêtre par défaut d'Ollama (2-4 k tokens)
 * tronquerait silencieusement le début et le modèle déraillerait.
 */
export const DIGEST_NUM_CTX = 8192;

/**
 * Délai des appels de digest : chargement du modèle + éval de ~4 k tokens +
 * longue réponse JSON dépassent facilement les 120 s par défaut sur ce GPU —
 * c'est une tâche de fond quotidienne, on lui laisse le temps de finir.
 */
export const DIGEST_TIMEOUT_MS = 600_000;

/**
 * Options partagées des complétions de digest (journaux, sujets, synthèse).
 * think:false — la prod tourne sur qwen3:14b (choix VRAM du launcher Tauri)
 * dont le mode raisonnement ruine la latence et pollue les sorties JSON ;
 * Ollama tolère le champ sur les modèles sans raisonnement (vérifié en 0.31).
 */
export const DIGEST_LLM_OPTS = {
  numCtx: DIGEST_NUM_CTX,
  timeoutMs: DIGEST_TIMEOUT_MS,
  think: false,
} as const;
