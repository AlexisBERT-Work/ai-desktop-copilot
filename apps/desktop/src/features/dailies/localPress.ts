import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import type { Daily, PressFeed, PressFeedInput, PressRunStatus } from '@catdesk/shared-types';
import { TAURI_EVENTS } from '@catdesk/shared-types';
import * as pressApi from '../../shared/api/press';

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
  /** Statut de génération (bandeau « Mes journaux ») — null tant qu'aucun run. */
  status: PressRunStatus | null;
  setFeeds: (feeds: PressFeed[]) => void;
  setDailies: (dailies: Daily[]) => void;
  setStatus: (status: PressRunStatus | null) => void;
}

export const useLocalPressStore = create<LocalPressState>()(set => ({
  feeds: [],
  dailies: [],
  status: null,
  setFeeds: feeds => set({ feeds }),
  setDailies: dailies => set({ dailies }),
  setStatus: status => set({ status }),
}));

/** Branche les events agent → store et demande l'état initial. Renvoie le cleanup. */
export function connectLocalPress(): () => void {
  const un1 = listen<{ feeds?: PressFeed[] }>(TAURI_EVENTS.pressFeeds, e => {
    useLocalPressStore.getState().setFeeds(e.payload.feeds ?? []);
  });
  const un2 = listen<{ dailies?: Daily[] }>(TAURI_EVENTS.dailiesLocal, e => {
    useLocalPressStore.getState().setDailies(e.payload.dailies ?? []);
  });
  const un3 = listen<{ status?: PressRunStatus }>(TAURI_EVENTS.pressProgress, e => {
    useLocalPressStore.getState().setStatus(e.payload.status ?? null);
  });
  // Resynchronisation : les notifications émises avant le chargement de la
  // fenêtre sont perdues — on redemande l'état complet à l'agent.
  void pressApi.syncLocalPress().catch(() => {});
  return () => {
    void un1.then(off => off());
    void un2.then(off => off());
    void un3.then(off => off());
  };
}

/** Enrobe un appel API en résultat `{ error }` consommable par les formulaires. */
async function fire(call: () => Promise<void>): Promise<{ error: string | null }> {
  try {
    await call();
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function saveLocalFeed(
  input: PressFeedInput & { id?: string },
): Promise<{ error: string | null }> {
  return fire(() => pressApi.saveLocalPressFeed(input));
}

export async function deleteLocalFeed(id: string): Promise<{ error: string | null }> {
  return fire(() => pressApi.deleteLocalPressFeed(id));
}

export async function runLocalPressNow(): Promise<{ error: string | null }> {
  return fire(() => pressApi.runLocalPressNow());
}
