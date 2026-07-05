import type { Widget, WidgetType } from '@catdesk/shared-types';
import {
  Zap,
  LineChart,
  Hash,
  Activity,
  BarChart3,
  Table2,
  Megaphone,
  Newspaper,
  Layers,
  LayoutList,
  type LucideIcon,
} from 'lucide-react';

/** Familles du menu d'ajout — l'ordre ici est l'ordre d'affichage. */
export const WIDGET_CATEGORIES = ['action', 'market', 'press'] as const;
export type WidgetCategory = (typeof WIDGET_CATEGORIES)[number];

export const WIDGET_CATEGORY_LABEL: Record<WidgetCategory, string> = {
  action: 'Actions',
  market: 'Marchés',
  press: 'Presse & dailys',
};

/** Métadonnées d'un type de widget : libellé, icône et constructeur par défaut. */
export interface WidgetMeta {
  type: WidgetType;
  label: string;
  /** Famille dans le menu d'ajout (regroupement visuel). */
  category: WidgetCategory;
  Icon: LucideIcon;
  /** Fabrique un widget neuf (sans id ; l'id est attribué par le store). */
  build: () => Omit<Widget, 'id'>;
}

export const WIDGET_META: readonly WidgetMeta[] = [
  {
    type: 'quick_action',
    label: 'Action rapide',
    category: 'action',
    Icon: Zap,
    build: () => ({
      type: 'quick_action',
      title: 'Action rapide',
      config: { iconName: 'zap', query: '' },
      layout: { x: 0, y: 0, w: 1, h: 1 },
    }),
  },
  {
    type: 'stocks',
    label: 'Bourse',
    category: 'market',
    Icon: LineChart,
    build: () => ({
      type: 'stocks',
      title: 'Bourse',
      dataSource: 'market',
      config: { symbols: ['AAPL', 'MSFT'] },
      layout: { x: 0, y: 0, w: 2, h: 2 },
    }),
  },
  {
    type: 'kpi',
    label: 'KPI',
    category: 'market',
    Icon: Hash,
    build: () => ({
      type: 'kpi',
      title: 'KPI',
      dataSource: 'market',
      config: { symbol: 'AAPL', field: 'price' },
      layout: { x: 0, y: 0, w: 1, h: 1 },
    }),
  },
  {
    type: 'stat',
    label: 'Statistique',
    category: 'market',
    Icon: Activity,
    build: () => ({
      type: 'stat',
      title: 'Statistique',
      dataSource: 'market',
      config: { symbol: 'AAPL', field: 'changePercent' },
      layout: { x: 0, y: 0, w: 1, h: 1 },
    }),
  },
  {
    type: 'chart',
    label: 'Graphe',
    category: 'market',
    Icon: BarChart3,
    build: () => ({
      type: 'chart',
      title: 'Graphe',
      dataSource: 'market',
      config: { symbol: 'AAPL' },
      layout: { x: 0, y: 0, w: 2, h: 2 },
    }),
  },
  {
    type: 'table',
    label: 'Table',
    category: 'market',
    Icon: Table2,
    build: () => ({
      type: 'table',
      title: 'Table',
      dataSource: 'market',
      config: { symbols: ['AAPL', 'MSFT', 'TSLA'] },
      layout: { x: 0, y: 0, w: 2, h: 2 },
    }),
  },
  {
    type: 'news',
    label: 'News',
    category: 'press',
    Icon: Megaphone,
    build: () => ({ type: 'news', title: 'News', config: {}, layout: { x: 0, y: 0, w: 2, h: 1 } }),
  },
  {
    type: 'dailies',
    label: 'Dailys · tout',
    category: 'press',
    Icon: LayoutList,
    build: () => ({
      type: 'dailies',
      title: 'Dailys',
      config: { kind: 'all' },
      layout: { x: 0, y: 0, w: 2, h: 2 },
    }),
  },
  {
    type: 'dailies',
    label: 'Dailys · sujets',
    category: 'press',
    Icon: Layers,
    build: () => ({
      type: 'dailies',
      title: 'Dailys — par sujet',
      config: { kind: 'topic' },
      layout: { x: 0, y: 0, w: 2, h: 2 },
    }),
  },
  {
    type: 'dailies',
    label: 'Dailys · journaux',
    category: 'press',
    Icon: Newspaper,
    build: () => ({
      type: 'dailies',
      title: 'Dailys — par journal',
      config: { kind: 'journal' },
      layout: { x: 0, y: 0, w: 2, h: 2 },
    }),
  },
];

/** Libellé lisible d'un type (pour les titres/placeholders). */
export function widgetLabel(type: WidgetType): string {
  return WIDGET_META.find((m) => m.type === type)?.label ?? type;
}
