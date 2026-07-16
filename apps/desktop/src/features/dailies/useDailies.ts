import { useEffect, useRef } from 'react';
import { isNewsConfigured as isSupabaseConfigured, supabase } from '../news/supabaseClient';
import { useDailiesStore } from './dailiesStore';
import { rowToDaily, type DailyRow } from './model';

/**
 * Taille d'une page de dailys. La fenêtre chargée démarre à cette taille et
 * grandit par pas de PAGE_SIZE via « Charger plus » (voir loadMore). Généreux
 * pour couvrir plusieurs jours d'un coup tout en gardant la charge bornée.
 */
export const PAGE_SIZE = 50;

/**
 * Charge les dailys au montage : auth anonyme (identité d'installation stable)
 * → fetch → abonnement Realtime. No-op (status 'unconfigured') si Supabase n'est
 * pas configuré. Lecture filtrée par RLS (non expirées). Le filtrage par
 * centre d'intérêt est appliqué localement (voir dailiesStore).
 */
export function useDailies(): void {
  const setItems = useDailiesStore(s => s.setItems);
  const setStatus = useDailiesStore(s => s.setStatus);
  const setHasMore = useDailiesStore(s => s.setHasMore);
  const setLoadingMore = useDailiesStore(s => s.setLoadingMore);
  const setLoadMore = useDailiesStore(s => s.setLoadMore);

  // Taille courante de la fenêtre chargée (offset 0 → window-1). Grandit via loadMore.
  const windowRef = useRef(PAGE_SIZE);

  useEffect(() => {
    if (!isSupabaseConfigured || supabase === null) {
      setStatus('unconfigured');
      return;
    }
    const client = supabase;
    let cancelled = false;

    // Recharge toute la fenêtre [0, window) en un appel : garde les pages déjà
    // dévoilées à jour (y compris après un événement Realtime) et recalcule
    // hasMore via le total exact renvoyé par Postgres.
    const load = async () => {
      const { data, error, count } = await client
        .from('dailies')
        .select('*', { count: 'exact' })
        .order('published_at', { ascending: false })
        .range(0, windowRef.current - 1);
      if (cancelled) return;
      if (error) {
        setStatus('error');
        return;
      }
      const rows = ((data ?? []) as DailyRow[]).map(rowToDaily);
      setItems(rows);
      setHasMore((count ?? rows.length) > rows.length);
      setStatus('ready');
    };

    // Étend la fenêtre d'une page puis recharge. Réentrance protégée par loadingMore.
    const loadMore = () => {
      if (useDailiesStore.getState().loadingMore) return;
      if (!useDailiesStore.getState().hasMore) return;
      setLoadingMore(true);
      windowRef.current += PAGE_SIZE;
      void load().finally(() => {
        if (!cancelled) setLoadingMore(false);
      });
    };
    setLoadMore(loadMore);

    void (async () => {
      setStatus('loading');
      const { data: sessionData } = await client.auth.getSession();
      if (sessionData.session === null) {
        await client.auth.signInAnonymously();
      }
      await load();
    })();

    const channel = client
      .channel('dailies')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dailies' }, () => {
        void load();
      })
      .subscribe();

    return () => {
      cancelled = true;
      setLoadMore(() => {});
      void client.removeChannel(channel);
    };
  }, [setItems, setStatus, setHasMore, setLoadingMore, setLoadMore]);
}
