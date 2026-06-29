import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isDailyCategory, type Daily, type DailyCategory } from '@catdesk/shared-types';

export type DailiesStatus = 'unconfigured' | 'loading' | 'ready' | 'error';

interface DailiesState {
  items: Daily[];
  status: DailiesStatus;
  /** Catégories suivies par l'utilisateur (persistées). Vide = toutes. */
  followed: DailyCategory[];

  setItems: (items: Daily[]) => void;
  setStatus: (status: DailiesStatus) => void;
  toggleCategory: (category: DailyCategory) => void;
  clearFollowed: () => void;
}

export const useDailiesStore = create<DailiesState>()(
  persist(
    (set) => ({
      items: [],
      status: 'loading',
      followed: [],

      setItems: (items) => set({ items }),
      setStatus: (status) => set({ status }),
      toggleCategory: (category) =>
        set((s) => ({
          followed: s.followed.includes(category)
            ? s.followed.filter((c) => c !== category)
            : [...s.followed, category],
        })),
      clearFollowed: () => set({ followed: [] }),
    }),
    {
      name: 'catdesk-dailies',
      // On ne persiste que les préférences ; les items viennent du backend.
      partialize: (s) => ({ followed: s.followed }),
      // Répare un état persisté éventuellement obsolète (catégorie supprimée…).
      merge: (persisted, current) => {
        const f = (persisted as { followed?: unknown } | null)?.followed;
        const followed = Array.isArray(f) ? f.filter(isDailyCategory) : [];
        return { ...current, followed };
      },
    },
  ),
);

/**
 * Dailys actives : non expirées, triées de la plus récente à la plus ancienne.
 * Le filtrage par catégorie suivie est appliqué séparément (voir filterByFollowed)
 * afin que les chips puissent toujours lister toutes les catégories. Pur.
 */
export function computeActiveDailies(items: Daily[]): Daily[] {
  const now = Date.now();
  return items
    .filter((d) => d.expiresAt === null || Date.parse(d.expiresAt) > now)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/** Restreint aux catégories suivies ; `followed` vide ⇒ tout. Pur. */
export function filterByFollowed(items: Daily[], followed: DailyCategory[]): Daily[] {
  if (followed.length === 0) return items;
  const set = new Set(followed);
  return items.filter((d) => set.has(d.category));
}
