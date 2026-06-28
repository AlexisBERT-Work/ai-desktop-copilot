import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DashboardConfig, Widget } from '@catdesk/shared-types';

const MAX_W = 4; // colonnes de la grille
const MAX_H = 2; // hauteurs possibles d'un widget

/**
 * Disposition par défaut au premier lancement : le bouton screenshot d'antan
 * devient un widget `quick_action`, à côté d'un widget `stocks` de démonstration
 * (données live câblées en P3).
 */
const DEFAULT_CONFIG: DashboardConfig = {
  version: 1,
  widgets: [
    {
      id: 'quick-screenshot',
      type: 'quick_action',
      title: 'Capture & analyse',
      config: { icon: '📸', query: 'Capture mon écran et décris ce que tu vois en détail.' },
      layout: { x: 0, y: 0, w: 1, h: 1 },
    },
    {
      id: 'quick-clipboard',
      type: 'quick_action',
      title: 'Presse-papier',
      config: { icon: '📋', query: 'Lis mon presse-papier et résume ou améliore le contenu.' },
      layout: { x: 0, y: 1, w: 1, h: 1 },
    },
    {
      id: 'stocks-demo',
      type: 'stocks',
      title: 'Bourse',
      dataSource: 'market',
      config: { symbols: ['AAPL', 'MSFT', 'TSLA'] },
      layout: { x: 1, y: 0, w: 2, h: 2 },
    },
  ],
};

// ─── Validation défensive du contenu persisté ──────────────────
function isWidget(x: unknown): x is Widget {
  if (x === null || typeof x !== 'object') return false;
  const w = x as Record<string, unknown>;
  return (
    typeof w.id === 'string' &&
    typeof w.type === 'string' &&
    typeof w.title === 'string' &&
    typeof w.config === 'object' &&
    w.config !== null &&
    typeof w.layout === 'object' &&
    w.layout !== null
  );
}

/** Reconstruit une config valide depuis un état persisté potentiellement obsolète/corrompu. */
function sanitizeConfig(persisted: unknown): DashboardConfig {
  if (persisted !== null && typeof persisted === 'object') {
    const cfg = (persisted as { config?: unknown }).config;
    if (cfg !== null && typeof cfg === 'object') {
      const widgets = (cfg as { widgets?: unknown }).widgets;
      if (Array.isArray(widgets) && widgets.every(isWidget)) {
        return { version: DEFAULT_CONFIG.version, widgets: widgets as Widget[] };
      }
    }
  }
  return DEFAULT_CONFIG;
}

const clampW = (w: number) => Math.min(Math.max(Math.round(w), 1), MAX_W);
const clampH = (h: number) => Math.min(Math.max(Math.round(h), 1), MAX_H);

interface DashboardState {
  config: DashboardConfig;
  /** Mode édition (transitoire, non persisté). */
  editMode: boolean;

  setEditMode: (on: boolean) => void;
  addWidget: (widget: Omit<Widget, 'id'>) => void;
  removeWidget: (id: string) => void;
  renameWidget: (id: string, title: string) => void;
  updateWidgetConfig: (id: string, patch: Record<string, unknown>) => void;
  cycleWidgetWidth: (id: string) => void;
  cycleWidgetHeight: (id: string) => void;
  reorderWidget: (sourceId: string, targetId: string) => void;
  resetToDefault: () => void;
}

/** Applique `fn` au widget `id`, renvoie une nouvelle liste de widgets. */
function mapWidget(widgets: Widget[], id: string, fn: (w: Widget) => Widget): Widget[] {
  return widgets.map((w) => (w.id === id ? fn(w) : w));
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
      config: DEFAULT_CONFIG,
      editMode: false,

      setEditMode: (on) => set({ editMode: on }),

      addWidget: (widget) =>
        set((s) => ({
          config: {
            ...s.config,
            widgets: [...s.config.widgets, { ...widget, id: crypto.randomUUID() }],
          },
        })),

      removeWidget: (id) =>
        set((s) => ({
          config: { ...s.config, widgets: s.config.widgets.filter((w) => w.id !== id) },
        })),

      renameWidget: (id, title) =>
        set((s) => ({
          config: {
            ...s.config,
            widgets: mapWidget(s.config.widgets, id, (w) => ({ ...w, title })),
          },
        })),

      updateWidgetConfig: (id, patch) =>
        set((s) => ({
          config: {
            ...s.config,
            widgets: mapWidget(s.config.widgets, id, (w) => ({
              ...w,
              config: { ...w.config, ...patch },
            })),
          },
        })),

      cycleWidgetWidth: (id) =>
        set((s) => ({
          config: {
            ...s.config,
            widgets: mapWidget(s.config.widgets, id, (w) => ({
              ...w,
              layout: { ...w.layout, w: clampW((w.layout.w % MAX_W) + 1) },
            })),
          },
        })),

      cycleWidgetHeight: (id) =>
        set((s) => ({
          config: {
            ...s.config,
            widgets: mapWidget(s.config.widgets, id, (w) => ({
              ...w,
              layout: { ...w.layout, h: clampH((w.layout.h % MAX_H) + 1) },
            })),
          },
        })),

      reorderWidget: (sourceId, targetId) =>
        set((s) => {
          if (sourceId === targetId) return {};
          const ws = [...s.config.widgets];
          const from = ws.findIndex((w) => w.id === sourceId);
          const to = ws.findIndex((w) => w.id === targetId);
          if (from === -1 || to === -1) return {};
          const moved = ws[from];
          if (moved === undefined) return {};
          ws.splice(from, 1);
          ws.splice(to, 0, moved);
          return { config: { ...s.config, widgets: ws } };
        }),

      resetToDefault: () => set({ config: DEFAULT_CONFIG }),
    }),
    {
      name: 'catdesk-dashboard',
      version: 1,
      // Ne persiste que la disposition ; `editMode` reste transitoire.
      partialize: (s) => ({ config: s.config }),
      // Valide/répare le contenu au rechargement (migration douce).
      merge: (persisted, current) => ({ ...current, config: sanitizeConfig(persisted) }),
    },
  ),
);

export { MAX_W, MAX_H };
