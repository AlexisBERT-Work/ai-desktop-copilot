import type { OllamaClient } from './OllamaClient';
import { createLogger } from '../logger';

const log = createLogger('agent:planner');

const MAX_STEPS = 8;

const PLAN_SYSTEM = `Tu es un planificateur. Décompose la tâche de l'utilisateur en 3 à 6 étapes
concises et actionnables, une par ligne, numérotées (1., 2., ...). Ne réponds QU'AVEC le plan,
sans introduction ni conclusion.`;

/**
 * Extrait une liste d'étapes depuis un texte de plan produit par le LLM.
 * Pur et déterministe (testable sans LLM).
 *
 * Reconnaît les lignes numérotées (`1.`, `2)`, `3:`) et à puces (`-`, `*`, `•`).
 * À défaut de marqueur, retombe sur les lignes non vides.
 */
export function parsePlan(text: string): string[] {
  const lines = text.split('\n');
  const steps: string[] = [];

  for (const line of lines) {
    const m = line.match(/^\s*(?:\d+\s*[.):]|[-*•])\s+(.+?)\s*$/);
    if (m && m[1]) steps.push(m[1].trim());
  }

  if (steps.length === 0) {
    for (const line of lines) {
      const t = line.trim();
      if (t.length > 0) steps.push(t);
    }
  }

  return steps.slice(0, MAX_STEPS);
}

/**
 * Génère un plan d'étapes pour une tâche, via un appel LLM non-outillé.
 * Réutilise `streamChat` (pas de nouvel endpoint) en accumulant les tokens.
 */
export class Planner {
  constructor(private llm: OllamaClient) {}

  async plan(input: string, model: string): Promise<string[]> {
    let text = '';
    try {
      const stream = this.llm.streamChat({
        model,
        system: PLAN_SYSTEM,
        messages: [{ role: 'user', content: input }],
        temperature: 0.3,
      });
      for await (const chunk of stream) {
        if (chunk.type === 'token') text += chunk.content;
        else if (chunk.type === 'error') {
          log.warn('Planning failed', { error: chunk.error });
          return [];
        }
      }
    } catch (err) {
      log.warn('Planning threw', { error: String(err) });
      return [];
    }

    const steps = parsePlan(text);
    log.info('Plan generated', { stepCount: steps.length });
    return steps;
  }
}
