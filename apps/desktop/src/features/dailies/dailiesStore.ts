import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  dailyKindFromTitle,
  isDailyCategory,
  type Daily,
  type DailyCategory,
  type DailyKindFilter,
} from '@catdesk/shared-types';

export type DailiesStatus = 'unconfigured' | 'loading' | 'ready' | 'error';

interface DailiesState {
  items: Daily[];
  status: DailiesStatus;
  /** Catégories suivies par l'utilisateur (persistées). Vide = toutes. */
  followed: DailyCategory[];
  /** Le serveur détient-il des dailys plus anciennes que la fenêtre chargée ? */
  hasMore: boolean;
  /** Un chargement de page supplémentaire est-il en cours ? */
  loadingMore: boolean;

  setItems: (items: Daily[]) => void;
  setStatus: (status: DailiesStatus) => void;
  setHasMore: (hasMore: boolean) => void;
  setLoadingMore: (loadingMore: boolean) => void;
  /**
   * Charge une page de plus depuis le serveur (dailys plus anciennes).
   * Implémenté par `useDailies` au montage ; no-op tant qu'il n'est pas câblé.
   */
  loadMore: () => void;
  setLoadMore: (fn: () => void) => void;
  toggleCategory: (category: DailyCategory) => void;
  clearFollowed: () => void;
}

export const useDailiesStore = create<DailiesState>()(
  persist(
    (set) => ({
      items: [],
      status: 'loading',
      followed: [],
      hasMore: false,
      loadingMore: false,

      setItems: (items) => set({ items }),
      setStatus: (status) => set({ status }),
      setHasMore: (hasMore) => set({ hasMore }),
      setLoadingMore: (loadingMore) => set({ loadingMore }),
      loadMore: () => {},
      setLoadMore: (fn) => set({ loadMore: fn }),
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

/**
 * Recherche approfondie : garde les dailys dont le titre OU le corps (donc les
 * articles/résumés) contient la requête (insensible à la casse). Vide ⇒ tout. Pur.
 */
export function searchDailies(items: Daily[], query: string): Daily[] {
  const q = query.trim().toLowerCase();
  if (q === '') return items;
  return items.filter((d) => `${d.title}\n${d.body}`.toLowerCase().includes(q));
}

/**
 * Restreint au genre du widget : 'journal' inclut la synthèse transversale ;
 * 'topic' = digests par sujet ; 'all' = tout. Pur.
 */
export function filterByKind(items: Daily[], kind: DailyKindFilter): Daily[] {
  if (kind === 'all') return items;
  return items.filter((d) => {
    const k = dailyKindFromTitle(d.title);
    return kind === 'journal' ? k === 'journal' || k === 'synthesis' : k === 'topic';
  });
}
