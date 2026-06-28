import { create } from 'zustand';
import type { ComputedValue, MarketSnapshot, Quote } from '@catdesk/shared-types';

interface MarketState {
  /** Dernière cotation par symbole (clé = symbole en MAJUSCULES). */
  quotes: Record<string, Quote>;
  /** Valeurs des formules calculées côté sidecar. */
  computed: ComputedValue[];
  /** Historique de prix récent par symbole (clé = MAJUSCULES) pour les sparklines. */
  history: Record<string, number[]>;
  /** Horodatage du dernier instantané reçu, ou null. */
  updatedAt: number | null;
  apply: (snapshot: MarketSnapshot) => void;
}

/** Alimenté par l'event Tauri `market:update` (voir useTauriEvents). */
export const useMarketStore = create<MarketState>((set) => ({
  quotes: {},
  computed: [],
  history: {},
  updatedAt: null,
  apply: (snapshot) =>
    set({
      quotes: Object.fromEntries(snapshot.quotes.map((q) => [q.symbol.toUpperCase(), q])),
      computed: snapshot.computed,
      history: Object.fromEntries(
        Object.entries(snapshot.history).map(([sym, values]) => [sym.toUpperCase(), values]),
      ),
      updatedAt: snapshot.timestamp,
    }),
}));
