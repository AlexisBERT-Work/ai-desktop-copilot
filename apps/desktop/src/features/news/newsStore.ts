import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { NewsItem } from '@catdesk/shared-types';

export type NewsStatus = 'unconfigured' | 'loading' | 'ready' | 'error';

interface NewsState {
  items: NewsItem[];
  status: NewsStatus;
  /** Ids masqués localement par l'utilisateur (persistés). */
  dismissedIds: string[];

  setItems: (items: NewsItem[]) => void;
  setStatus: (status: NewsStatus) => void;
  dismiss: (id: string) => void;
}

export const useNewsStore = create<NewsState>()(
  persist(
    (set) => ({
      items: [],
      status: 'loading',
      dismissedIds: [],

      setItems: (items) => set({ items }),
      setStatus: (status) => set({ status }),
      dismiss: (id) =>
        set((s) => (s.dismissedIds.includes(id) ? {} : { dismissedIds: [...s.dismissedIds, id] })),
    }),
    {
      name: 'catdesk-news',
      // On ne persiste que les masquages ; les items viennent du backend.
      partialize: (s) => ({ dismissedIds: s.dismissedIds }),
    },
  ),
);

/**
 * News actives : non masquées, non expirées, triées de la plus récente à la
 * plus ancienne. Fonction pure (à mémoïser côté composant pour éviter de
 * recréer un tableau à chaque rendu).
 */
export function computeActiveNews(items: NewsItem[], dismissedIds: string[]): NewsItem[] {
  const now = Date.now();
  const dismissed = new Set(dismissedIds);
  return items
    .filter((n) => !dismissed.has(n.id))
    .filter((n) => n.expiresAt === null || Date.parse(n.expiresAt) > now)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}
