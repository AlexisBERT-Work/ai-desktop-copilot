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
  type LucideIcon,
} from 'lucide-react';

/** Métadonnées d'un type de widget : libellé, icône et constructeur par défaut. */
export interface WidgetMeta {
  type: WidgetType;
  label: string;
  Icon: LucideIcon;
  /** Fabrique un widget neuf (sans id ; l'id est attribué par le store). */
  build: () => Omit<Widget, 'id'>;
}

export const WIDGET_META: readonly WidgetMeta[] = [
  {
    type: 'quick_action',
    label: 'Action rapide',
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
    Icon: Megaphone,
    build: () => ({ type: 'news', title: 'News', config: {}, layout: { x: 0, y: 0, w: 2, h: 1 } }),
  },
  {
    type: 'dailies',
    label: 'Dailys',
    Icon: Newspaper,
    build: () => ({ type: 'dailies', title: 'Dailys', config: {}, layout: { x: 0, y: 0, w: 2, h: 2 } }),
  },
];

/** Libellé lisible d'un type (pour les titres/placeholders). */
export function widgetLabel(type: WidgetType): string {
  return WIDGET_META.find((m) => m.type === type)?.label ?? type;
}
