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
 * Période du retry automatique tant qu'on est en erreur. La fenêtre Marchés &
 * News n'est jamais démontée (fermer = masquer, garde dans main.tsx) : sans ce
 * ticker, un échec resterait affiché jusqu'au redémarrage complet de l'app.
 */
const RETRY_INTERVAL_MS = 60_000;

/** Erreurs Supabase qui traduisent une session périmée plutôt qu'un backend HS. */
function isAuthError(err: { code?: string; message?: string }): boolean {
  const code = err.code ?? '';
  const msg = (err.message ?? '').toLowerCase();
  return code === 'PGRST301' || code === '42501' || msg.includes('jwt') || msg.includes('token');
}

/** Message court et lisible pour l'UI (le message brut peut être une page HTML). */
function describe(err: { message?: string }): string {
  const raw = (err.message ?? '').trim();
  if (raw === '' || raw.toLowerCase().includes('failed to fetch')) {
    return 'Service indisponible (projet en veille ou hors ligne).';
  }
  return raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
}

/**
 * Charge les dailys au montage : auth anonyme (identité d'installation stable)
 * → fetch → abonnement Realtime. No-op (status 'unconfigured') si Supabase n'est
 * pas configuré. Lecture filtrée par RLS (non expirées). Le filtrage par
 * centre d'intérêt est appliqué localement (voir dailiesStore).
 *
 * En cas d'échec, l'état d'erreur n'est pas terminal : retry manuel (bouton),
 * retry périodique, et relance au retour du focus fenêtre.
 */
export function useDailies(): void {
  const setItems = useDailiesStore(s => s.setItems);
  const setStatus = useDailiesStore(s => s.setStatus);
  const setError = useDailiesStore(s => s.setError);
  const setHasMore = useDailiesStore(s => s.setHasMore);
  const setLoadingMore = useDailiesStore(s => s.setLoadingMore);
  const setLoadMore = useDailiesStore(s => s.setLoadMore);
  const setRetry = useDailiesStore(s => s.setRetry);

  // Taille courante de la fenêtre chargée (offset 0 → window-1). Grandit via loadMore.
  const windowRef = useRef(PAGE_SIZE);

  useEffect(() => {
    if (!isSupabaseConfigured || supabase === null) {
      setStatus('unconfigured');
      return;
    }
    const client = supabase;
    let cancelled = false;

    // Garantit une session : les policies RLS des dailys sont `to authenticated`,
    // donc sans session on lit zéro ligne (sans erreur) au lieu des dailys.
    const ensureSession = async (force = false): Promise<void> => {
      if (!force) {
        const { data } = await client.auth.getSession();
        if (data.session !== null) return;
      }
      await client.auth.signInAnonymously();
    };

    // Recharge toute la fenêtre [0, window) en un appel : garde les pages déjà
    // dévoilées à jour (y compris après un événement Realtime) et recalcule
    // hasMore via le total exact renvoyé par Postgres. Une erreur d'auth
    // déclenche une ré-authentification puis un second essai.
    const load = async (retriedAuth = false): Promise<void> => {
      const { data, error, count } = await client
        .from('dailies')
        .select('*', { count: 'exact' })
        .order('published_at', { ascending: false })
        .range(0, windowRef.current - 1);
      if (cancelled) return;
      if (error) {
        if (!retriedAuth && isAuthError(error)) {
          await ensureSession(true);
          if (cancelled) return;
          return load(true);
        }
        setError(describe(error));
        setStatus('error');
        return;
      }
      const rows = ((data ?? []) as DailyRow[]).map(rowToDaily);
      setItems(rows);
      setHasMore((count ?? rows.length) > rows.length);
      setError(null);
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

    // Cycle complet auth + fetch. Réutilisé au montage, par le bouton
    // « Réessayer », par le ticker et au retour du focus.
    const reload = async () => {
      if (cancelled) return;
      setStatus('loading');
      await ensureSession();
      if (cancelled) return;
      await load();
    };
    setRetry(() => {
      void reload();
    });

    void reload();

    // Ne réessaie que si l'état courant est encore en erreur : pas de trafic
    // inutile quand tout va bien (Realtime prend le relais).
    const retryIfFailed = () => {
      if (useDailiesStore.getState().status === 'error') void reload();
    };
    const timer = setInterval(retryIfFailed, RETRY_INTERVAL_MS);
    window.addEventListener('focus', retryIfFailed);

    const channel = client
      .channel('dailies')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dailies' }, () => {
        void load();
      })
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', retryIfFailed);
      setLoadMore(() => {});
      setRetry(() => {});
      void client.removeChannel(channel);
    };
  }, [setItems, setStatus, setError, setHasMore, setLoadingMore, setLoadMore, setRetry]);
}
