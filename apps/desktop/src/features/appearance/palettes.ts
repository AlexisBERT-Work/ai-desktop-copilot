/**
 * Palettes d'accent de l'application. Chaque palette est une rampe complète
 * 50→900 : elle est injectée dans les variables `--color-brand-*` définies par
 * le bloc `@theme` de globals.css, ce qui repeint d'un coup TOUTES les classes
 * `brand-*` de l'app (boutons, bordures, icônes) sans toucher au JSX.
 */

export const ACCENT_NAMES = ['violet', 'blue', 'emerald', 'amber', 'rose', 'cyan'] as const;
export type AccentName = (typeof ACCENT_NAMES)[number];

export function isAccentName(x: unknown): x is AccentName {
  return typeof x === 'string' && (ACCENT_NAMES as readonly string[]).includes(x);
}

type Ramp = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string>;

export const ACCENT_PALETTES: Record<AccentName, Ramp> = {
  // Violet CatDesk — l'identité d'origine, valeur par défaut.
  violet: {
    50: '#f5f0ff',
    100: '#ede0ff',
    200: '#dbc5ff',
    300: '#c09aff',
    400: '#a16ef4',
    500: '#8b47e8',
    600: '#7a2fd4',
    700: '#6622b0',
    800: '#551e90',
    900: '#471c76',
  },
  blue: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',
  },
  emerald: {
    50: '#ecfdf5',
    100: '#d1fae5',
    200: '#a7f3d0',
    300: '#6ee7b7',
    400: '#34d399',
    500: '#10b981',
    600: '#059669',
    700: '#047857',
    800: '#065f46',
    900: '#064e3b',
  },
  amber: {
    50: '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    300: '#fcd34d',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
    800: '#92400e',
    900: '#78350f',
  },
  rose: {
    50: '#fff1f2',
    100: '#ffe4e6',
    200: '#fecdd3',
    300: '#fda4af',
    400: '#fb7185',
    500: '#f43f5e',
    600: '#e11d48',
    700: '#be123c',
    800: '#9f1239',
    900: '#881337',
  },
  cyan: {
    50: '#ecfeff',
    100: '#cffafe',
    200: '#a5f3fc',
    300: '#67e8f9',
    400: '#22d3ee',
    500: '#06b6d4',
    600: '#0891b2',
    700: '#0e7490',
    800: '#155e75',
    900: '#164e63',
  },
};

export const ACCENT_LABELS: Record<AccentName, string> = {
  violet: 'Violet',
  blue: 'Bleu',
  emerald: 'Vert',
  amber: 'Ambre',
  rose: 'Rose',
  cyan: 'Cyan',
};

/**
 * Fonds possibles pour la fenêtre Marchés & News. `page` habille le tableau,
 * `card` le remplissage par défaut des cartes — les deux doivent rester
 * contrastés l'un par rapport à l'autre pour que les cartes se détachent.
 */
export const SURFACE_NAMES = ['slate', 'ink', 'midnight', 'contrast'] as const;
export type SurfaceName = (typeof SURFACE_NAMES)[number];

export function isSurfaceName(x: unknown): x is SurfaceName {
  return typeof x === 'string' && (SURFACE_NAMES as readonly string[]).includes(x);
}

export const SURFACES: Record<SurfaceName, { label: string; page: string; card: string }> = {
  slate: { label: 'Ardoise', page: '#0a0a0a', card: '#18181b' },
  ink: { label: 'Encre', page: '#000000', card: '#141414' },
  midnight: { label: 'Nuit bleutée', page: '#0b1120', card: '#151f36' },
  contrast: { label: 'Contraste élevé', page: '#000000', card: '#232326' },
};

/** Densité : pilote l'espace intérieur des cartes et l'aération des listes. */
export const DENSITY_NAMES = ['compact', 'normal', 'roomy'] as const;
export type DensityName = (typeof DENSITY_NAMES)[number];

export function isDensityName(x: unknown): x is DensityName {
  return typeof x === 'string' && (DENSITY_NAMES as readonly string[]).includes(x);
}

export const DENSITIES: Record<DensityName, { label: string; pad: string; gap: string }> = {
  compact: { label: 'Compact', pad: '0.5rem', gap: '0.25rem' },
  normal: { label: 'Normal', pad: '0.75rem', gap: '0.5rem' },
  roomy: { label: 'Aéré', pad: '1.125rem', gap: '0.75rem' },
};

/** Coin d'ancrage de la bulle overlay à l'écran. */
export const CORNER_NAMES = [
  'bottom-right',
  'bottom-left',
  'top-right',
  'top-left',
  'center',
] as const;
export type CornerName = (typeof CORNER_NAMES)[number];

export function isCornerName(x: unknown): x is CornerName {
  return typeof x === 'string' && (CORNER_NAMES as readonly string[]).includes(x);
}

export const CORNER_LABELS: Record<CornerName, string> = {
  'bottom-right': 'En bas à droite',
  'bottom-left': 'En bas à gauche',
  'top-right': 'En haut à droite',
  'top-left': 'En haut à gauche',
  center: 'Centré',
};

/** Gabarit de la bulle : largeur en px logiques, appliquée fenêtre + contenu. */
export const BUBBLE_SIZES = ['compact', 'normal', 'large'] as const;
export type BubbleSize = (typeof BUBBLE_SIZES)[number];

export function isBubbleSize(x: unknown): x is BubbleSize {
  return typeof x === 'string' && (BUBBLE_SIZES as readonly string[]).includes(x);
}

export const BUBBLE_DIMENSIONS: Record<
  BubbleSize,
  { label: string; miniW: number; miniH: number; chatW: number; chatH: number }
> = {
  compact: { label: 'Compacte', miniW: 520, miniH: 150, chatW: 640, chatH: 560 },
  normal: { label: 'Normale', miniW: 600, miniH: 170, chatW: 724, chatH: 648 },
  large: { label: 'Grande', miniW: 720, miniH: 196, chatW: 860, chatH: 740 },
};
