import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DashboardConfig, Widget, WidgetLayout, WidgetStyle } from '@catdesk/shared-types';
import { WIDGET_ACCENTS } from '@catdesk/shared-types';

// ─── Canvas libre (façon PowerPoint) ───────────────────────────
// `layout` est en PIXELS : position (x, y) et taille (w, h) exactes, posées où
// l'on veut sur un canvas. Le contenu d'un widget trop petit défile À L'INTÉRIEUR
// de sa carte. Un léger snap évite les désalignements d'un demi-pixel.

/** Pas d'aimantation du canvas (positions et tailles multiples de 8 px). */
const SNAP = 8;
const MIN_W = 160;
const MIN_H = 88;
const MAX_W = 1600;
const MAX_H = 1400;
const MAX_X = 6000;
const MAX_Y = 40000;

// ─── Migration de l'ancienne grille (v1 : 4 colonnes d'unités) ─
// Une unité de l'ancienne grille vaut ce gabarit en px (multiples du SNAP).
const UNIT_W = 288;
const UNIT_H = 120;
const GAP = 16;

/** Un layout dont les dimensions tiennent en unités de grille (≤ 8) date de la v1. */
function isGridUnits(l: WidgetLayout): boolean {
  return l.w <= 8 && l.h <= 8;
}

/** Convertit un layout v1 (unités de grille) en px canvas. Pur, exporté pour tests. */
export function fromGridUnits(l: WidgetLayout): WidgetLayout {
  return {
    x: l.x * (UNIT_W + GAP),
    y: l.y * (UNIT_H + GAP),
    w: l.w * UNIT_W + (l.w - 1) * GAP,
    h: l.h * UNIT_H + (l.h - 1) * GAP,
  };
}

const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const clampW = (w: number) => Math.min(Math.max(snap(w), MIN_W), MAX_W);
const clampH = (h: number) => Math.min(Math.max(snap(h), MIN_H), MAX_H);
const clampX = (x: number) => Math.min(Math.max(snap(x), 0), MAX_X);
const clampY = (y: number) => Math.min(Math.max(snap(y), 0), MAX_Y);

const clampLayout = (l: WidgetLayout): WidgetLayout => ({
  x: clampX(l.x),
  y: clampY(l.y),
  w: clampW(l.w),
  h: clampH(l.h),
});

/**
 * Disposition par défaut au premier lancement : le bouton screenshot d'antan
 * devient un widget `quick_action`, à côté d'un widget `stocks` de démonstration
 * (données live câblées en P3). Positions en px canvas (v2).
 */
const DEFAULT_CONFIG: DashboardConfig = {
  version: 2,
  widgets: [
    {
      id: 'kpi-aapl',
      type: 'kpi',
      title: 'AAPL',
      dataSource: 'market',
      config: { symbol: 'AAPL', field: 'price', label: 'AAPL · prix' },
      layout: { x: 0, y: 0, w: 288, h: 120 },
    },
    {
      id: 'stat-aapl',
      type: 'stat',
      title: 'AAPL var.',
      dataSource: 'market',
      config: { symbol: 'AAPL', field: 'changePercent', label: 'AAPL · jour' },
      layout: { x: 304, y: 0, w: 288, h: 120 },
    },
    {
      id: 'news-demo',
      type: 'news',
      title: 'News',
      config: {},
      layout: { x: 608, y: 0, w: 592, h: 120 },
    },
    {
      id: 'stocks-demo',
      type: 'stocks',
      title: 'Watchlist',
      dataSource: 'market',
      config: {
        symbols: ['AAPL', 'MSFT', 'TSLA'],
        formulas: [{ name: 'AAPL/MSFT', expression: 'AAPL.price / MSFT.price' }],
      },
      layout: { x: 0, y: 136, w: 592, h: 256 },
    },
    {
      id: 'chart-aapl',
      type: 'chart',
      title: 'AAPL — graphe',
      dataSource: 'market',
      config: { symbol: 'AAPL' },
      layout: { x: 608, y: 136, w: 592, h: 256 },
    },
    {
      id: 'quick-screenshot',
      type: 'quick_action',
      title: 'Capture & analyse',
      config: {
        iconName: 'camera',
        query: 'Capture mon écran et décris ce que tu vois en détail.',
      },
      layout: { x: 0, y: 408, w: 288, h: 120 },
    },
    {
      id: 'dailies-topics',
      type: 'dailies',
      title: 'Dailys — par sujet',
      config: { kind: 'topic' },
      layout: { x: 0, y: 544, w: 592, h: 256 },
    },
    {
      id: 'dailies-journals',
      type: 'dailies',
      title: 'Dailys — par journal',
      config: { kind: 'journal' },
      layout: { x: 608, y: 544, w: 592, h: 256 },
    },
  ],
};

/**
 * Affichage enregistré : un instantané nommé de la disposition complète, que
 * l'on peut restaurer à volonté (plusieurs mises en page pour un même poste).
 */
export interface LayoutPreset {
  id: string;
  name: string;
  widgets: Widget[];
}

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

/** Migre (v1 → px) et borne une liste de widgets. */
function migrateWidgets(widgets: Widget[]): Widget[] {
  return widgets.map(w => ({
    ...w,
    layout: clampLayout(isGridUnits(w.layout) ? fromGridUnits(w.layout) : w.layout),
  }));
}

/**
 * Reconstruit une config valide depuis un état persisté potentiellement
 * obsolète/corrompu. Migre au passage les layouts v1 (unités de grille) vers
 * les px du canvas libre. Pur, exporté pour tests.
 */
export function sanitizeConfig(persisted: unknown): DashboardConfig {
  if (persisted !== null && typeof persisted === 'object') {
    const cfg = (persisted as { config?: unknown }).config;
    if (cfg !== null && typeof cfg === 'object') {
      const widgets = (cfg as { widgets?: unknown }).widgets;
      if (Array.isArray(widgets) && widgets.every(isWidget)) {
        return { version: DEFAULT_CONFIG.version, widgets: migrateWidgets(widgets as Widget[]) };
      }
    }
  }
  return DEFAULT_CONFIG;
}

/**
 * Ne garde que les affichages enregistrés valides de l'état persisté (id, nom,
 * widgets sains) — un preset corrompu est écarté sans toucher aux autres.
 * Pur, exporté pour tests.
 */
export function sanitizePresets(persisted: unknown): LayoutPreset[] {
  if (persisted === null || typeof persisted !== 'object') return [];
  const raw = (persisted as { presets?: unknown }).presets;
  if (!Array.isArray(raw)) return [];
  const out: LayoutPreset[] = [];
  for (const p of raw) {
    if (p === null || typeof p !== 'object') continue;
    const { id, name, widgets } = p as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string') continue;
    if (!Array.isArray(widgets) || !widgets.every(isWidget)) continue;
    out.push({ id, name, widgets: migrateWidgets(widgets as Widget[]) });
  }
  return out;
}

interface DashboardState {
  config: DashboardConfig;
  /** Affichages enregistrés (dispositions nommées, persistées). */
  presets: LayoutPreset[];
  /** Mode édition (transitoire, non persisté). */
  editMode: boolean;

  setEditMode: (on: boolean) => void;
  addWidget: (widget: Omit<Widget, 'id'>) => void;
  removeWidget: (id: string) => void;
  renameWidget: (id: string, title: string) => void;
  updateWidgetConfig: (id: string, patch: Record<string, unknown>) => void;
  /** Personnalisation visuelle (accent, taille du texte). Fusion + bornes. */
  setWidgetStyle: (id: string, patch: WidgetStyle) => void;
  /** Taille exacte en px (poignées de redimensionnement). Snap + bornes. */
  setWidgetSize: (id: string, w: number, h: number) => void;
  /** Position exacte en px sur le canvas (drag). Snap + bornes. */
  moveWidget: (id: string, x: number, y: number) => void;
  /** Passe le widget au premier plan (fin de liste = dessiné en dernier). */
  bringToFront: (id: string) => void;
  /** Enregistre la disposition ACTUELLE sous un nom (instantané indépendant). */
  savePreset: (name: string) => void;
  /** Restaure un affichage enregistré (remplace la disposition actuelle). */
  applyPreset: (id: string) => void;
  deletePreset: (id: string) => void;
  resetToDefault: () => void;
}

/** Applique `fn` au widget `id`, renvoie une nouvelle liste de widgets. */
function mapWidget(widgets: Widget[], id: string, fn: (w: Widget) => Widget): Widget[] {
  return widgets.map(w => (w.id === id ? fn(w) : w));
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    set => ({
      config: DEFAULT_CONFIG,
      presets: [],
      editMode: false,

      setEditMode: on => set({ editMode: on }),

      addWidget: widget =>
        set(s => {
          // Les fabriques (widgetMeta) livrent encore des tailles v1 en unités
          // de grille : converties ici. Placement : sous tout le contenu.
          const size = isGridUnits(widget.layout) ? fromGridUnits(widget.layout) : widget.layout;
          const bottom = s.config.widgets.reduce((m, w) => Math.max(m, w.layout.y + w.layout.h), 0);
          const layout = clampLayout({ ...size, x: 0, y: bottom > 0 ? bottom + GAP : 0 });
          return {
            config: {
              ...s.config,
              widgets: [...s.config.widgets, { ...widget, layout, id: crypto.randomUUID() }],
            },
          };
        }),

      removeWidget: id =>
        set(s => ({
          config: { ...s.config, widgets: s.config.widgets.filter(w => w.id !== id) },
        })),

      renameWidget: (id, title) =>
        set(s => ({
          config: {
            ...s.config,
            widgets: mapWidget(s.config.widgets, id, w => ({ ...w, title })),
          },
        })),

      updateWidgetConfig: (id, patch) =>
        set(s => ({
          config: {
            ...s.config,
            widgets: mapWidget(s.config.widgets, id, w => ({
              ...w,
              config: { ...w.config, ...patch },
            })),
          },
        })),

      setWidgetStyle: (id, patch) =>
        set(s => ({
          config: {
            ...s.config,
            widgets: mapWidget(s.config.widgets, id, w => {
              const merged: WidgetStyle = { ...w.style, ...patch };
              const accent =
                merged.accent !== undefined && WIDGET_ACCENTS.includes(merged.accent)
                  ? merged.accent
                  : 'default';
              const textScale = Math.min(
                Math.max(typeof merged.textScale === 'number' ? merged.textScale : 1, 0.7),
                1.6,
              );
              return { ...w, style: { accent, textScale } };
            }),
          },
        })),

      setWidgetSize: (id, w, h) =>
        set(s => {
          const cw = clampW(w);
          const ch = clampH(h);
          const cur = s.config.widgets.find(v => v.id === id);
          // Snap inchangé → pas d'écriture (évite le churn pendant le geste).
          if (cur === undefined || (cur.layout.w === cw && cur.layout.h === ch)) return {};
          return {
            config: {
              ...s.config,
              widgets: mapWidget(s.config.widgets, id, widget => ({
                ...widget,
                layout: { ...widget.layout, w: cw, h: ch },
              })),
            },
          };
        }),

      moveWidget: (id, x, y) =>
        set(s => {
          const cx = clampX(x);
          const cy = clampY(y);
          const cur = s.config.widgets.find(v => v.id === id);
          if (cur === undefined || (cur.layout.x === cx && cur.layout.y === cy)) return {};
          return {
            config: {
              ...s.config,
              widgets: mapWidget(s.config.widgets, id, widget => ({
                ...widget,
                layout: { ...widget.layout, x: cx, y: cy },
              })),
            },
          };
        }),

      bringToFront: id =>
        set(s => {
          const ws = s.config.widgets;
          const idx = ws.findIndex(w => w.id === id);
          if (idx === -1 || idx === ws.length - 1) return {};
          const moved = ws[idx];
          if (moved === undefined) return {};
          return {
            config: { ...s.config, widgets: [...ws.slice(0, idx), ...ws.slice(idx + 1), moved] },
          };
        }),

      savePreset: name =>
        set(s => ({
          presets: [
            ...s.presets,
            {
              id: crypto.randomUUID(),
              name: name.trim() || `Affichage ${s.presets.length + 1}`,
              // Instantané indépendant : les éditions ultérieures du canvas ne
              // doivent pas modifier l'affichage enregistré.
              widgets: structuredClone(s.config.widgets),
            },
          ],
        })),

      applyPreset: id =>
        set(s => {
          const preset = s.presets.find(p => p.id === id);
          if (preset === undefined) return {};
          return { config: { ...s.config, widgets: structuredClone(preset.widgets) } };
        }),

      deletePreset: id => set(s => ({ presets: s.presets.filter(p => p.id !== id) })),

      resetToDefault: () => set({ config: DEFAULT_CONFIG }),
    }),
    {
      name: 'catdesk-dashboard',
      version: 1,
      // Persiste la disposition et les affichages enregistrés ; `editMode`
      // reste transitoire.
      partialize: s => ({ config: s.config, presets: s.presets }),
      // Valide/répare/migre le contenu au rechargement (migration douce).
      merge: (persisted, current) => ({
        ...current,
        config: sanitizeConfig(persisted),
        presets: sanitizePresets(persisted),
      }),
    },
  ),
);

export { MIN_W, MIN_H, MAX_W, MAX_H, SNAP };
