import { useEffect } from 'react';
import type { NewsItem, NewsSeverity } from '@catdesk/shared-types';
import { isNewsConfigured, supabase } from './supabaseClient';
import { useNewsStore } from './newsStore';

/** Forme brute d'une ligne `news` (colonnes Postgres en snake_case). */
interface NewsRow {
  id: string;
  title: string;
  body: string;
  severity: string;
  audience_client_id: string | null;
  published_at: string;
  expires_at: string | null;
}

const SEVERITIES: readonly NewsSeverity[] = ['info', 'success', 'warning', 'critical'];

function toSeverity(s: string): NewsSeverity {
  return SEVERITIES.includes(s as NewsSeverity) ? (s as NewsSeverity) : 'info';
}

function rowToItem(r: NewsRow): NewsItem {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    severity: toSeverity(r.severity),
    audienceClientId: r.audience_client_id,
    publishedAt: r.published_at,
    expiresAt: r.expires_at,
  };
}

/**
 * Charge la news au montage : auth anonyme (identité d'installation stable) →
 * fetch → abonnement Realtime. No-op (status 'unconfigured') si Supabase n'est
 * pas configuré. Les requêtes sont filtrées par RLS (global + ciblé, non expiré).
 */
export function useNews(): void {
  const setItems = useNewsStore((s) => s.setItems);
  const setStatus = useNewsStore((s) => s.setStatus);

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
      setItems(((data ?? []) as NewsRow[]).map(rowToItem));
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
