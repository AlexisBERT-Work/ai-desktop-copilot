import type { Widget, WidgetType } from '@catdesk/shared-types';

/** Métadonnées d'un type de widget : libellé, icône et constructeur par défaut. */
export interface WidgetMeta {
  type: WidgetType;
  label: string;
  icon: string;
  /** Fabrique un widget neuf (sans id ; l'id est attribué par le store). */
  build: () => Omit<Widget, 'id'>;
}

export const WIDGET_META: readonly WidgetMeta[] = [
  {
    type: 'quick_action',
    label: 'Action rapide',
    icon: '⚡',
    build: () => ({
      type: 'quick_action',
      title: 'Action rapide',
      config: { icon: '⚡', query: '' },
      layout: { x: 0, y: 0, w: 1, h: 1 },
    }),
  },
  {
    type: 'stocks',
    label: 'Bourse',
    icon: '📈',
    build: () => ({
      type: 'stocks',
      title: 'Bourse',
      dataSource: 'market',
      config: { symbols: [] },
      layout: { x: 0, y: 0, w: 2, h: 2 },
    }),
  },
  {
    type: 'kpi',
    label: 'KPI',
    icon: '🔢',
    build: () => ({ type: 'kpi', title: 'KPI', config: {}, layout: { x: 0, y: 0, w: 1, h: 1 } }),
  },
  {
    type: 'stat',
    label: 'Statistique',
    icon: '📊',
    build: () => ({ type: 'stat', title: 'Statistique', config: {}, layout: { x: 0, y: 0, w: 1, h: 1 } }),
  },
  {
    type: 'chart',
    label: 'Graphe',
    icon: '📉',
    build: () => ({ type: 'chart', title: 'Graphe', config: {}, layout: { x: 0, y: 0, w: 2, h: 2 } }),
  },
  {
    type: 'table',
    label: 'Table',
    icon: '▦',
    build: () => ({ type: 'table', title: 'Table', config: {}, layout: { x: 0, y: 0, w: 2, h: 1 } }),
  },
  {
    type: 'news',
    label: 'News',
    icon: '📰',
    build: () => ({ type: 'news', title: 'News', config: {}, layout: { x: 0, y: 0, w: 3, h: 1 } }),
  },
];

/** Libellé lisible d'un type (pour les titres/placeholders). */
export function widgetLabel(type: WidgetType): string {
  return WIDGET_META.find((m) => m.type === type)?.label ?? type;
}
