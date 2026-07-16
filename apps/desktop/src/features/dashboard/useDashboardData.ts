import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { MarketSnapshot } from '@catdesk/shared-types';
import { TAURI_EVENTS } from '@catdesk/shared-types';
import { useMarketStore } from '../market/marketStore';
import { useNews } from '../news/useNews';
import { useDailies } from '../dailies/useDailies';
import { connectLocalPress } from '../dailies/localPress';
import { useMarketWatchSync } from '../market/useMarketWatchSync';

/**
 * Câblage data de la fenêtre dashboard (contexte JS séparé du bot) :
 * - écoute `market:update` (diffusé à toutes les fenêtres) → marketStore
 * - écoute les journaux/dailys locaux poussés par l'agent → localPressStore
 * - charge la news + les dailys (Supabase) et synchronise la watchlist
 */
export function useDashboardData(): void {
  const applyMarket = useMarketStore(s => s.apply);

  useEffect(() => {
    const un = listen<MarketSnapshot>(TAURI_EVENTS.marketUpdate, e => applyMarket(e.payload));
    return () => {
      void un.then(off => off());
    };
  }, [applyMarket]);

  useEffect(() => connectLocalPress(), []);

  useNews();
  useDailies();
  useMarketWatchSync();
}
