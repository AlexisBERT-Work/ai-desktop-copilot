// ─── Dashboard / Widgets ───────────────────────────────────────
// Ossature de l'interface configurable (Pilier A). Le détail du schéma de
// `config` propre à chaque type de widget est volontairement laissé ouvert
// (Record<string, unknown>) et sera spécifié widget par widget.

export type WidgetType =
  | 'kpi'
  | 'stat'
  | 'chart'
  | 'table'
  | 'stocks'
  | 'quick_action'
  | 'news';

/** Position/taille dans la grille, en unités de colonnes/lignes. */
export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Un widget paramétrable de l'interface dashboard. */
export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  /** Id d'un provider de données (ex. 'market', 'system'). Absent = widget autonome. */
  dataSource?: string;
  /** Options propres au type de widget (schéma défini plus tard). */
  config: Record<string, unknown>;
  layout: WidgetLayout;
}

/** Disposition complète de l'accueil, persistée entre sessions. */
export interface DashboardConfig {
  version: number;
  widgets: Widget[];
}
