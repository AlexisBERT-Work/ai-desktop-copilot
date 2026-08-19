import { useEffect } from 'react';
import { ACCENT_PALETTES, DENSITIES, SURFACES } from './palettes';
import {
  APPEARANCE_STORAGE_KEY,
  useAppearanceStore,
  type AppearanceState,
} from './appearanceStore';

/** Portée d'application : seule la fenêtre Marchés & News met le texte à
 *  l'échelle (la bulle a des dimensions fixes en px, l'agrandir la ferait
 *  déborder — son gabarit se règle via « Taille de la bulle »). */
export type AppearanceScope = 'dashboard' | 'overlay';

/**
 * Écrit les préférences dans les variables CSS de `:root`. Les utilitaires
 * Tailwind lisent `--color-brand-*` (bloc @theme de globals.css), donc
 * réécrire ces variables repeint l'app entière sans re-render React.
 */
export function applyAppearance(a: AppearanceState, scope: AppearanceScope): void {
  const root = document.documentElement;
  const ramp = ACCENT_PALETTES[a.accent];
  for (const [shade, hex] of Object.entries(ramp)) {
    root.style.setProperty(`--color-brand-${shade}`, hex);
  }

  const surface = SURFACES[a.surface];
  root.style.setProperty('--dash-bg', surface.page);
  root.style.setProperty('--card-bg', surface.card);

  const density = DENSITIES[a.density];
  root.style.setProperty('--card-pad', density.pad);
  root.style.setProperty('--card-gap', density.gap);

  root.style.setProperty('--bubble-opacity', String(a.bubbleOpacity));

  // rem racine : met à l'échelle toutes les tailles Tailwind du tableau de bord.
  root.style.fontSize = scope === 'dashboard' ? `${16 * a.fontScale}px` : '';

  root.dataset['animations'] = a.animations ? 'on' : 'off';
}

/**
 * Applique l'apparence courante et la maintient à jour, y compris quand elle est
 * modifiée depuis l'AUTRE fenêtre (événement `storage` → réhydratation du store
 * persisté). À monter une fois par racine (App et DashboardRoot).
 */
export function useAppearance(scope: AppearanceScope): void {
  const appearance = useAppearanceStore();

  useEffect(() => {
    applyAppearance(appearance, scope);
  }, [appearance, scope]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== APPEARANCE_STORAGE_KEY) return;
      void useAppearanceStore.persist.rehydrate();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}
