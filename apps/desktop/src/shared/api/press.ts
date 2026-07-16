import { invoke } from '@tauri-apps/api/core';
import type { PressFeedInput } from '@catdesk/shared-types';

/** Publication immédiate de la revue de presse partagée (console admin). */
export function runPressDigest(): Promise<void> {
  return invoke('run_press_digest');
}

/** Redemande l'état complet des journaux locaux (press:feeds + dailies:local). */
export function syncLocalPress(): Promise<void> {
  return invoke('sync_local_press');
}

export function saveLocalPressFeed(feed: PressFeedInput & { id?: string }): Promise<void> {
  return invoke('save_local_press_feed', { feed });
}

export function deleteLocalPressFeed(id: string): Promise<void> {
  return invoke('delete_local_press_feed', { id });
}

/** Génération immédiate des journaux locaux (« Générer maintenant »). */
export function runLocalPressNow(): Promise<void> {
  return invoke('run_local_press_now');
}
