import { useEffect } from 'react';
import { isDailyCategory, type Daily } from '@catdesk/shared-types';
import { isNewsConfigured as isSupabaseConfigured, supabase } from '../news/supabaseClient';
import { useDailiesStore } from './dailiesStore';

/** Forme brute d'une ligne `dailies` (colonnes Postgres en snake_case). */
interface DailyRow {
  id: string;
  title: string;
  body: string;
  category: string;
  published_at: string;
  expires_at: string | null;
}

function rowToDaily(r: DailyRow): Daily {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    category: isDailyCategory(r.category) ? r.category : 'misc',
    publishedAt: r.published_at,
    expiresAt: r.expires_at,
  };
}

/**
 * Charge les dailys au montage : auth anonyme (identité d'installation stable)
 * → fetch → abonnement Realtime. No-op (status 'unconfigured') si Supabase n'est
 * pas configuré. Lecture filtrée par RLS (non expirées). Le filtrage par
 * centre d'intérêt est appliqué localement (voir dailiesStore).
 */
export function useDailies(): void {
  const setItems = useDailiesStore((s) => s.setItems);
  const setStatus = useDailiesStore((s) => s.setStatus);

  useEffect(() => {
    if (!isSupabaseConfigured || supabase === null) {
      setStatus('unconfigured');
      return;
    }
    const client = supabase;
    let cancelled = false;

    const load = async () => {
      const { data, error } = await client
        .from('dailies')
        .select('*')
        .order('published_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        setStatus('error');
        return;
      }
      setItems(((data ?? []) as DailyRow[]).map(rowToDaily));
      setStatus('ready');
    };

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
      void client.removeChannel(channel);
    };
  }, [setItems, setStatus]);
}
