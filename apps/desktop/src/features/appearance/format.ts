import { useAppearanceStore } from './appearanceStore';

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CHF: 'CHF',
};

export interface NumberFormat {
  /** Prix : décimales et séparateurs choisis, devise suffixée si demandée. */
  price: (value: number) => string;
  /** Pourcentage signé, toujours 2 décimales (lisibilité de la variation). */
  percent: (value: number) => string;
  /** Entier avec séparateurs de milliers (volumes). */
  integer: (value: number) => string;
  /** Valeur libre (formules) : entier tel quel, sinon décimales choisies +2. */
  loose: (value: number) => string;
}

/**
 * Fabrique les formateurs à partir des préférences. Pur (hors lecture du store),
 * donc réutilisable côté tests avec des valeurs explicites.
 */
export function makeNumberFormat(locale: string, decimals: number, currency: string): NumberFormat {
  const suffix = currency === 'none' ? '' : ` ${CURRENCY_SYMBOL[currency] ?? currency}`;
  const fixed = (v: number, d: number) =>
    v.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });

  return {
    price: v => `${fixed(v, decimals)}${suffix}`,
    percent: v => `${v >= 0 ? '+' : ''}${fixed(v, 2)} %`,
    integer: v => v.toLocaleString(locale, { maximumFractionDigits: 0 }),
    loose: v =>
      Number.isInteger(v)
        ? v.toLocaleString(locale)
        : v.toLocaleString(locale, { maximumFractionDigits: decimals + 2 }),
  };
}

/** Formateurs suivant les préférences courantes (réactif : re-render au changement). */
export function useNumberFormat(): NumberFormat {
  const locale = useAppearanceStore(s => s.numberLocale);
  const decimals = useAppearanceStore(s => s.decimals);
  const currency = useAppearanceStore(s => s.currency);
  return makeNumberFormat(locale, decimals, currency);
}
