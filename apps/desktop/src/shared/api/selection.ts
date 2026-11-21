import { invoke } from '@tauri-apps/api/core';
import type { SelectionOutcome } from '@catdesk/shared-types';

/**
 * Active ou retire le raccourci Ctrl+Alt+T (transformer le texte sélectionné
 * dans n'importe quelle application). Rejette si le raccourci est déjà pris.
 */
export function selectionSetEnabled(enabled: boolean): Promise<void> {
  return invoke('selection_set_enabled', { enabled });
}

/**
 * Envoie la sélection en attente à l'agent avec la consigne. Le résultat
 * arrive par l'événement `selection:update`. Le texte, lui, ne quitte jamais
 * le cœur : seule la consigne part d'ici.
 */
export function selectionTransform(instruction: string, model: string): Promise<void> {
  return invoke('selection_transform', { instruction, model });
}

/** Colle le résultat validé à la place de la sélection, dans l'application d'origine. */
export function selectionReplace(): Promise<SelectionOutcome> {
  return invoke('selection_replace');
}

/** Abandonne la sélection en attente (et la transformation en cours). */
export function selectionCancel(): Promise<void> {
  return invoke('selection_cancel');
}
