import type {
  Widget,
  WidgetAccent,
  WidgetBorder,
  WidgetRadius,
  WidgetStyle,
  WidgetSurface,
} from '@catdesk/shared-types';
import {
  WIDGET_ACCENTS,
  WIDGET_BORDERS,
  WIDGET_RADII,
  WIDGET_SURFACES,
} from '@catdesk/shared-types';

/**
 * Classes Tailwind par accent — écrites en toutes lettres (le JIT ne voit pas
 * les classes construites dynamiquement). `border`/`title` habillent la carte,
 * `swatch` colore la pastille du sélecteur, `tint` sert de fond « teinté ».
 */
export const ACCENT_STYLES: Record<
  WidgetAccent,
  { border: string; title: string; swatch: string; tint: string }
> = {
  default: {
    border: 'border-white/10',
    title: 'text-white/60',
    swatch: 'bg-white/30',
    tint: 'bg-white/5',
  },
  sky: {
    border: 'border-sky-400/40',
    title: 'text-sky-200',
    swatch: 'bg-sky-400',
    tint: 'bg-sky-500/10',
  },
  emerald: {
    border: 'border-emerald-400/40',
    title: 'text-emerald-200',
    swatch: 'bg-emerald-400',
    tint: 'bg-emerald-500/10',
  },
  amber: {
    border: 'border-amber-400/40',
    title: 'text-amber-200',
    swatch: 'bg-amber-400',
    tint: 'bg-amber-500/10',
  },
  rose: {
    border: 'border-rose-400/40',
    title: 'text-rose-200',
    swatch: 'bg-rose-400',
    tint: 'bg-rose-500/10',
  },
  violet: {
    border: 'border-violet-400/40',
    title: 'text-violet-200',
    swatch: 'bg-violet-400',
    tint: 'bg-violet-500/10',
  },
};

export const ACCENT_LABEL: Record<WidgetAccent, string> = {
  default: 'Neutre',
  sky: 'Bleu',
  emerald: 'Vert',
  amber: 'Ambre',
  rose: 'Rose',
  violet: 'Violet',
};

/** Paliers de taille du texte proposés dans l'éditeur. */
export const TEXT_SCALES: readonly { value: number; label: string }[] = [
  { value: 0.85, label: 'A⁻' },
  { value: 1, label: 'A' },
  { value: 1.15, label: 'A⁺' },
  { value: 1.3, label: 'A⁺⁺' },
];

export const SURFACE_LABEL: Record<WidgetSurface, string> = {
  auto: 'Auto',
  solid: 'Uni',
  tinted: 'Teinté',
  clear: 'Transparent',
};

export const BORDER_LABEL: Record<WidgetBorder, string> = {
  none: 'Aucun',
  thin: 'Fin',
  thick: 'Épais',
};

export const RADIUS_LABEL: Record<WidgetRadius, string> = {
  sharp: 'Droit',
  soft: 'Doux',
  round: 'Rond',
};

/** Classes d'arrondi (littérales, pour le JIT Tailwind). */
export const RADIUS_CLASS: Record<WidgetRadius, string> = {
  sharp: 'rounded-none',
  soft: 'rounded-xl',
  round: 'rounded-3xl',
};

/** Épaisseur du contour (littérale). 'none' garde `border-0` pour ne pas hériter. */
export const BORDER_CLASS: Record<WidgetBorder, string> = {
  none: 'border-0',
  thin: 'border',
  thick: 'border-2',
};

/** Style d'une carte, toutes valeurs résolues. */
export interface ResolvedWidgetStyle {
  accent: WidgetAccent;
  textScale: number;
  surface: WidgetSurface;
  opacity: number;
  hideHeader: boolean;
  border: WidgetBorder;
  radius: WidgetRadius;
  locked: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Normalise un style partiel (widget ancien, valeur hors bornes, champ inconnu)
 * en style complet. Source de vérité unique : le store l'utilise pour écrire,
 * les composants pour lire — impossible qu'ils divergent.
 */
export function normalizeWidgetStyle(style: WidgetStyle | undefined): ResolvedWidgetStyle {
  const s = style ?? {};
  return {
    accent: s.accent !== undefined && WIDGET_ACCENTS.includes(s.accent) ? s.accent : 'default',
    textScale: typeof s.textScale === 'number' ? clamp(s.textScale, 0.7, 1.6) : 1,
    surface: s.surface !== undefined && WIDGET_SURFACES.includes(s.surface) ? s.surface : 'auto',
    opacity: typeof s.opacity === 'number' ? clamp(s.opacity, 0.2, 1) : 1,
    hideHeader: s.hideHeader === true,
    border: s.border !== undefined && WIDGET_BORDERS.includes(s.border) ? s.border : 'thin',
    radius: s.radius !== undefined && WIDGET_RADII.includes(s.radius) ? s.radius : 'soft',
    locked: s.locked === true,
  };
}

/** Style effectif d'un widget, avec valeurs sûres (widget ancien sans style). */
export function readWidgetStyle(widget: Widget): ResolvedWidgetStyle {
  return normalizeWidgetStyle(widget.style);
}
