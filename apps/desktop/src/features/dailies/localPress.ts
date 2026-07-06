import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Daily, PressFeed, PressFeedInput } from '@catdesk/shared-types';

/**
 * Journaux personnalisés LOCAUX — propres à ce poste, gérés par l'agent local
 * (aucun rôle admin ni Supabase). L'état arrive par events Tauri poussés par
 * l'agent (`press:feeds`, `dailies:local`) ; les écritures partent en
 * fire-and-forget via les commandes Tauri.
 */
interface LocalPressState {
  feeds: PressFeed[];
  /** Dailys générées localement — fusionnées avec les partagées dans le widget. */
  dailies: Daily[];
  setFeeds: (feeds: PressFeed[]) => void;
  setDailies: (dailies: Daily[]) => void;
}

export const useLocalPressStore = create<LocalPressState>()((set) => ({
  feeds: [],
  dailies: [],
  setFeeds: (feeds) => set({ feeds }),
  setDailies: (dailies) => set({ dailies }),
}));

/** Branche les events agent → store et demande l'état initial. Renvoie le cleanup. */
export function connectLocalPress(): () => void {
  const un1 = listen<{ feeds?: PressFeed[] }>('press:feeds', (e) => {
    useLocalPressStore.getState().setFeeds(e.payload.feeds ?? []);
  });
  const un2 = listen<{ dailies?: Daily[] }>('dailies:local', (e) => {
    useLocalPressStore.getState().setDailies(e.payload.dailies ?? []);
  });
  // Resynchronisation : les notifications émises avant le chargement de la
  // fenêtre sont perdues — on redemande l'état complet à l'agent.
  void invoke('sync_local_press').catch(() => {});
  return () => {
    void un1.then((off) => off());
    void un2.then((off) => off());
  };
}

async function fire(cmd: string, args?: Record<string, unknown>): Promise<{ error: string | null }> {
  try {
    await invoke(cmd, args);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function saveLocalFeed(
  input: PressFeedInput & { id?: string },
): Promise<{ error: string | null }> {
  return fire('save_local_press_feed', { feed: input });
}

export async function deleteLocalFeed(id: string): Promise<{ error: string | null }> {
  return fire('delete_local_press_feed', { id });
}

export async function runLocalPressNow(): Promise<{ error: string | null }> {
  return fire('run_local_press_now');
}
