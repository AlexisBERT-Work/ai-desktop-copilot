import type { VoiceDictationEvent, VoiceDictationOutcome } from '@catdesk/shared-types';

/** Durée d'affichage d'une issue avant que la pastille redevienne vide. */
export const RESULT_MS = 2500;

export type PillTone = 'recording' | 'busy' | 'ok' | 'warn';

export interface PillView {
  tone: PillTone;
  text: string;
}

const OUTCOME_TEXT: Record<Exclude<VoiceDictationOutcome, 'inserted'>, string> = {
  empty: 'Rien entendu : rien n’a été écrit',
  focus_changed: 'Fenêtre changée : rien n’a été écrit',
  elevated: 'Appli en administrateur : Windows bloque la frappe',
  keys_held: 'Ctrl ou Alt encore enfoncés : rien n’a été écrit',
  blocked: 'Windows a refusé la frappe',
  no_models: 'Modèles de reconnaissance absents',
  mic_error: 'Micro indisponible',
  busy: 'CatDesk transcrit déjà : réessaie',
};

/**
 * Ce que la pastille de dictée affiche pour un événement (`null` = rien).
 * Jamais le texte dicté : seulement l'état, ou le nombre de caractères écrits.
 */
export function pillView(event: VoiceDictationEvent | null): PillView | null {
  if (!event) return null;
  if (event.phase === 'recording') {
    return { tone: 'recording', text: 'Je t’écoute — relâche pour écrire' };
  }
  if (event.phase === 'transcribing') return { tone: 'busy', text: 'Transcription…' };
  const outcome = event.outcome ?? 'empty';
  if (outcome === 'inserted') {
    const n = event.chars;
    return { tone: 'ok', text: `${n} caractère${n > 1 ? 's' : ''} écrit${n > 1 ? 's' : ''}` };
  }
  return { tone: 'warn', text: OUTCOME_TEXT[outcome] };
}
