import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { MarketSnapshot } from '@catdesk/shared-types';
import { useMarketStore } from '../market/marketStore';
import { useNews } from '../news/useNews';
import { useMarketWatchSync } from '../market/useMarketWatchSync';

/**
 * Câblage data de la fenêtre dashboard (contexte JS séparé du bot) :
 * - écoute `market:update` (diffusé à toutes les fenêtres) → marketStore
 * - charge la news (Supabase) et synchronise la watchlist depuis les widgets
 */
export function useDashboardData(): void {
  const applyMarket = useMarketStore((s) => s.apply);

  useEffect(() => {
    const un = listen<MarketSnapshot>('market:update', (e) => applyMarket(e.payload));
    return () => {
      void un.then((off) => off());
    };
  }, [applyMarket]);

  useNews();
  useMarketWatchSync();
}
