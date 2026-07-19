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
  | 'news'
  | 'dailies';

/**
 * Position/taille sur le canvas libre du dashboard, en px (v2). Les anciennes
 * dispositions v1 (unités de grille ≤ 8) sont migrées au chargement par le
 * store du dashboard.
 */
export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Accents de couleur disponibles pour personnaliser un widget. */
export const WIDGET_ACCENTS = ['default', 'sky', 'emerald', 'amber', 'rose', 'violet'] as const;
export type WidgetAccent = (typeof WIDGET_ACCENTS)[number];

/** Personnalisation visuelle d'un widget (couleur d'accent, taille du texte). */
export interface WidgetStyle {
  /** Couleur d'accent (bordure + titre). 'default' = neutre. */
  accent?: WidgetAccent;
  /** Facteur de taille du texte du contenu (zoom local, borné ~0.7–1.6). */
  textScale?: number;
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
  /** Personnalisation visuelle (optionnelle, persistée avec la disposition). */
  style?: WidgetStyle;
}

/** Disposition complète de l'accueil, persistée entre sessions. */
export interface DashboardConfig {
  version: number;
  widgets: Widget[];
}
