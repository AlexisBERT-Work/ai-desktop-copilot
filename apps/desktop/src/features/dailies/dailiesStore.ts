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
    set => ({
      items: [],
      status: 'loading',
      followed: [],
      hasMore: false,
      loadingMore: false,

      setItems: items => set({ items }),
      setStatus: status => set({ status }),
      setHasMore: hasMore => set({ hasMore }),
      setLoadingMore: loadingMore => set({ loadingMore }),
      loadMore: () => {},
      setLoadMore: fn => set({ loadMore: fn }),
      toggleCategory: category =>
        set(s => ({
          followed: s.followed.includes(category)
            ? s.followed.filter(c => c !== category)
            : [...s.followed, category],
        })),
      clearFollowed: () => set({ followed: [] }),
    }),
    {
      name: 'catdesk-dailies',
      // On ne persiste que les préférences ; les items viennent du backend.
      partialize: s => ({ followed: s.followed }),
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
    .filter(d => d.expiresAt === null || Date.parse(d.expiresAt) > now)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/** Restreint aux catégories suivies ; `followed` vide ⇒ tout. Pur. */
export function filterByFollowed(items: Daily[], followed: DailyCategory[]): Daily[] {
  if (followed.length === 0) return items;
  const set = new Set(followed);
  return items.filter(d => set.has(d.category));
}

/**
 * Recherche approfondie : garde les dailys dont le titre OU le corps (donc les
 * articles/résumés) contient la requête (insensible à la casse). Vide ⇒ tout. Pur.
 */
export function searchDailies(items: Daily[], query: string): Daily[] {
  const q = query.trim().toLowerCase();
  if (q === '') return items;
  return items.filter(d => `${d.title}\n${d.body}`.toLowerCase().includes(q));
}

/**
 * Restreint au genre du widget : 'journal' inclut la synthèse transversale ;
 * 'topic' = digests par sujet ; 'all' = tout. Pur.
 */
export function filterByKind(items: Daily[], kind: DailyKindFilter): Daily[] {
  if (kind === 'all') return items;
  return items.filter(d => {
    const k = dailyKindFromTitle(d.title);
    return kind === 'journal' ? k === 'journal' || k === 'synthesis' : k === 'topic';
  });
}

/** Filtre d'origine d'un widget dailys : tout, partagées, ou persos (ce poste). */
export type DailyOriginFilter = 'all' | 'shared' | 'local';

export const DAILY_ORIGIN_LABEL: Record<DailyOriginFilter, string> = {
  all: 'Toutes',
  shared: 'Partagées',
  local: 'Persos',
};

export function isDailyOriginFilter(x: unknown): x is DailyOriginFilter {
  return x === 'all' || x === 'shared' || x === 'local';
}

/**
 * Restreint à une origine ; une daily sans tag est partagée (données serveur).
 * 'all' ⇒ tout. Pur.
 */
export function filterByOrigin(items: Daily[], origin: DailyOriginFilter): Daily[] {
  if (origin === 'all') return items;
  return items.filter(d => (d.origin ?? 'shared') === origin);
}

/** Fenêtre temporelle d'un widget dailys. */
export type DailyPeriodFilter = 'today' | 'week' | 'all';

export const DAILY_PERIOD_LABEL: Record<DailyPeriodFilter, string> = {
  today: "Aujourd'hui",
  week: '7 jours',
  all: 'Tout',
};

export function isDailyPeriod(x: unknown): x is DailyPeriodFilter {
  return x === 'today' || x === 'week' || x === 'all';
}

/** Restreint à la fenêtre temporelle (jour local ; 'week' = 7 derniers jours). Pur. */
export function filterByPeriod(
  items: Daily[],
  period: DailyPeriodFilter,
  now = new Date(),
): Daily[] {
  if (period === 'all') return items;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - 6);
  return items.filter(d => {
    const t = Date.parse(d.publishedAt);
    return !Number.isNaN(t) && t >= start.getTime();
  });
}

/**
 * Source lisible d'une daily, déduite des préfixes stables du pipeline :
 * « <Journal> — revue du … » → journal ; « Sujet — <Sujet> · … » → sujet ;
 * synthèse transversale → « Synthèse ». Pur.
 */
export function dailySourceLabel(title: string): string {
  if (title.startsWith('Synthèse du jour')) return 'Synthèse';
  if (title.startsWith('Sujet — ')) {
    const rest = title.slice('Sujet — '.length);
    const dot = rest.indexOf(' · ');
    return (dot === -1 ? rest : rest.slice(0, dot)).trim();
  }
  const dash = title.indexOf(' — ');
  return (dash === -1 ? title : title.slice(0, dash)).trim();
}

/** Sources distinctes des dailys données, triées alphabétiquement. Pur. */
export function listDailySources(items: Daily[]): string[] {
  return [...new Set(items.map(d => dailySourceLabel(d.title)))].sort((a, b) =>
    a.localeCompare(b, 'fr'),
  );
}

/** Restreint à une source (journal ou sujet) ; '' ⇒ toutes. Pur. */
export function filterBySource(items: Daily[], source: string): Daily[] {
  if (source === '') return items;
  return items.filter(d => dailySourceLabel(d.title) === source);
}
