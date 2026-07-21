import { useEffect } from 'react';
import { isNewsConfigured, supabase } from './supabaseClient';
import { useNewsStore } from './newsStore';
import { rowToNews, type NewsRow } from './model';

/**
 * Charge la news au montage : auth anonyme (identité d'installation stable) →
 * fetch → abonnement Realtime. No-op (status 'unconfigured') si Supabase n'est
 * pas configuré. Les requêtes sont filtrées par RLS (global + ciblé, non expiré).
 */
export function useNews(): void {
  const setItems = useNewsStore(s => s.setItems);
  const setStatus = useNewsStore(s => s.setStatus);

  useEffect(() => {
    if (!isNewsConfigured || supabase === null) {
      setStatus('unconfigured');
      return;
    }
    const client = supabase;
    let cancelled = false;

    const load = async () => {
      const { data, error } = await client
        .from('news')
        .select('*')
        .order('published_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        setStatus('error');
        return;
      }
      setItems(((data ?? []) as NewsRow[]).map(rowToNews));
      setStatus('ready');
    };

    void (async () => {
      setStatus('loading');
      const { data: sessionData } = await client.auth.getSession();
      if (sessionData.session === null) {
        // Anonyme : nécessite « Anonymous sign-ins » activé côté Supabase.
        await client.auth.signInAnonymously();
      }
      await load();
    })();

    const channel = client
      .channel('news')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'news' }, () => {
        void load();
      })
      .subscribe();

    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [setItems, setStatus]);
}
