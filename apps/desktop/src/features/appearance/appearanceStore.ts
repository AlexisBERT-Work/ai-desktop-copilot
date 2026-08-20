import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  isAccentName,
  isBubbleSize,
  isCornerName,
  isDensityName,
  isSurfaceName,
  type AccentName,
  type BubbleSize,
  type CornerName,
  type DensityName,
  type SurfaceName,
} from './palettes';

/** Paliers de taille du texte de la fenêtre Marchés & News (racine rem). */
export const FONT_SCALES: readonly { value: number; label: string }[] = [
  { value: 0.9, label: 'A⁻' },
  { value: 1, label: 'A' },
  { value: 1.1, label: 'A⁺' },
  { value: 1.25, label: 'A⁺⁺' },
];

/** Intervalles proposés pour le rafraîchissement des cotations. */
export const REFRESH_CHOICES: readonly { seconds: number; label: string }[] = [
  { seconds: 15, label: '15 s' },
  { seconds: 30, label: '30 s' },
  { seconds: 60, label: '1 min' },
  { seconds: 300, label: '5 min' },
];

export const NUMBER_LOCALES = ['fr-FR', 'en-US', 'de-DE'] as const;
export type NumberLocale = (typeof NUMBER_LOCALES)[number];

export const LOCALE_LABELS: Record<NumberLocale, string> = {
  'fr-FR': 'Français (1 234,56)',
  'en-US': 'Anglais (1,234.56)',
  'de-DE': 'Allemand (1.234,56)',
};

export const CURRENCIES = ['none', 'USD', 'EUR', 'GBP', 'CHF'] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export interface AppearanceState {
  // ─── Apparence globale ───────────────────────────────────────
  accent: AccentName;
  surface: SurfaceName;
  density: DensityName;
  fontScale: number;
  /** Animations d'entrée et micro-transitions. Coupées = rendu instantané. */
  animations: boolean;

  // ─── Bulle overlay ───────────────────────────────────────────
  bubbleSize: BubbleSize;
  corner: CornerName;
  /** Opacité du fond de la bulle (0.6–1). */
  bubbleOpacity: number;
  /** Panneau affiché quand la bulle est invoquée. */
  launchMode: 'mini' | 'chat';

  // ─── Contenu & données ───────────────────────────────────────
  refreshSeconds: number;
  numberLocale: NumberLocale;
  currency: CurrencyCode;
  /** Décimales des prix (0–4). */
  decimals: number;

  set: (patch: Partial<AppearanceState>) => void;
  reset: () => void;
}

const DEFAULTS = {
  accent: 'violet',
  surface: 'slate',
  density: 'normal',
  fontScale: 1,
  animations: true,
  bubbleSize: 'normal',
  corner: 'bottom-right',
  bubbleOpacity: 0.96,
  launchMode: 'mini',
  refreshSeconds: 30,
  numberLocale: 'fr-FR',
  currency: 'none',
  decimals: 2,
} as const satisfies Omit<AppearanceState, 'set' | 'reset'>;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Ramène un état persisté quelconque (version antérieure, clé bidouillée) sur
 *  des valeurs valides. Toute valeur inconnue retombe sur le défaut. */
function sanitize(raw: unknown): Omit<AppearanceState, 'set' | 'reset'> {
  const p = (raw ?? {}) as Partial<Record<keyof AppearanceState, unknown>>;
  const num = (v: unknown, fallback: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;

  return {
    accent: isAccentName(p.accent) ? p.accent : DEFAULTS.accent,
    surface: isSurfaceName(p.surface) ? p.surface : DEFAULTS.surface,
    density: isDensityName(p.density) ? p.density : DEFAULTS.density,
    fontScale: num(p.fontScale, DEFAULTS.fontScale, 0.8, 1.4),
    animations: typeof p.animations === 'boolean' ? p.animations : DEFAULTS.animations,
    bubbleSize: isBubbleSize(p.bubbleSize) ? p.bubbleSize : DEFAULTS.bubbleSize,
    corner: isCornerName(p.corner) ? p.corner : DEFAULTS.corner,
    bubbleOpacity: num(p.bubbleOpacity, DEFAULTS.bubbleOpacity, 0.6, 1),
    launchMode: p.launchMode === 'chat' ? 'chat' : DEFAULTS.launchMode,
    refreshSeconds: num(p.refreshSeconds, DEFAULTS.refreshSeconds, 10, 3600),
    numberLocale: (NUMBER_LOCALES as readonly unknown[]).includes(p.numberLocale)
      ? (p.numberLocale as NumberLocale)
      : DEFAULTS.numberLocale,
    currency: (CURRENCIES as readonly unknown[]).includes(p.currency)
      ? (p.currency as CurrencyCode)
      : DEFAULTS.currency,
    decimals: Math.round(num(p.decimals, DEFAULTS.decimals, 0, 4)),
  };
}

export const APPEARANCE_STORAGE_KEY = 'catdesk-appearance';

/**
 * Préférences d'apparence et de confort, persistées et PARTAGÉES par les deux
 * fenêtres (même origine ⇒ même localStorage). La propagation d'une fenêtre à
 * l'autre est assurée par `useAppearance`, qui réhydrate sur l'événement
 * `storage` — sans quoi changer l'accent depuis les réglages ne repeindrait
 * pas le tableau de bord déjà ouvert.
 */
export const useAppearanceStore = create<AppearanceState>()(
  persist(
    set => ({
      ...DEFAULTS,
      set: patch => set(s => sanitize({ ...s, ...patch })),
      reset: () => set(sanitize({})),
    }),
    {
      name: APPEARANCE_STORAGE_KEY,
      partialize: s => {
        const { set: _set, reset: _reset, ...rest } = s;
        return rest;
      },
      merge: (persisted, current) => ({ ...current, ...sanitize(persisted) }),
    },
  ),
);
