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

/**
 * Remplissage d'une carte. 'auto' suit le fond global choisi dans Apparence ;
 * 'tinted' teinte la carte de son accent ; 'clear' la rend transparente (utile
 * pour poser un titre ou un KPI directement sur le fond du tableau).
 */
export const WIDGET_SURFACES = ['auto', 'solid', 'tinted', 'clear'] as const;
export type WidgetSurface = (typeof WIDGET_SURFACES)[number];

/** Épaisseur du contour d'une carte. */
export const WIDGET_BORDERS = ['none', 'thin', 'thick'] as const;
export type WidgetBorder = (typeof WIDGET_BORDERS)[number];

/** Arrondi des coins d'une carte. */
export const WIDGET_RADII = ['sharp', 'soft', 'round'] as const;
export type WidgetRadius = (typeof WIDGET_RADII)[number];

/** Personnalisation visuelle d'un widget. Tout est optionnel : une carte créée
 *  par une version antérieure reste valide et prend les valeurs par défaut. */
export interface WidgetStyle {
  /** Couleur d'accent (bordure + titre). 'default' = neutre. */
  accent?: WidgetAccent;
  /** Facteur de taille du texte du contenu (zoom local, borné ~0.7–1.6). */
  textScale?: number;
  /** Remplissage de la carte. Défaut 'auto'. */
  surface?: WidgetSurface;
  /** Opacité de la carte, bornée 0.2–1. Défaut 1. */
  opacity?: number;
  /** Masque la barre de titre pour un rendu épuré (les contrôles restent en mode édition). */
  hideHeader?: boolean;
  /** Épaisseur du contour. Défaut 'thin'. */
  border?: WidgetBorder;
  /** Arrondi des coins. Défaut 'soft'. */
  radius?: WidgetRadius;
  /** Carte verrouillée : ni déplacement ni redimensionnement, même en mode édition. */
  locked?: boolean;
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
