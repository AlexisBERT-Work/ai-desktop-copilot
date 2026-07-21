import type { NewsItem, NewsSeverity } from '@catdesk/shared-types';
import { supabase } from './supabaseClient';
import { rowToNews, type NewsRow } from './model';

/** Données saisies à la création/édition d'une news. */
export interface NewsInput {
  title: string;
  body: string;
  severity: NewsSeverity;
  /** null = tous les postes ; sinon cible un client précis (son auth.uid()). */
  audienceClientId: string | null;
  /** ISO 8601 ou null (pas d'expiration). */
  expiresAt: string | null;
}

const NOT_CONFIGURED = 'Supabase non configuré.';

/**
 * Toutes les news (y compris expirées et ciblées) — réservé à l'admin : la
 * policy `news_admin_write` (for all) lui ouvre aussi la lecture intégrale,
 * comme pour les dailys (cf. dailiesAdmin.ts).
 */
export async function listAllNews(): Promise<{ items: NewsItem[]; error: string | null }> {
  if (supabase === null) return { items: [], error: NOT_CONFIGURED };
  const { data, error } = await supabase
    .from('news')
    .select('*')
    .order('published_at', { ascending: false });
  if (error) return { items: [], error: error.message };
  return { items: ((data ?? []) as NewsRow[]).map(rowToNews), error: null };
}

export async function createNews(input: NewsInput): Promise<{ error: string | null }> {
  if (supabase === null) return { error: NOT_CONFIGURED };
  const { error } = await supabase.from('news').insert({
    title: input.title,
    body: input.body,
    severity: input.severity,
    // Toujours envoyée explicitement (jamais omise) : une clé absente laisse
    // Postgres appliquer son défaut (NULL = global) sans que l'appelant l'ait
    // décidé — piège vécu en testant l'API à la main. Ici le choix vient
    // TOUJOURS du formulaire (case « tous les postes » cochée par défaut).
    audience_client_id: input.audienceClientId,
    expires_at: input.expiresAt,
  });
  return { error: error?.message ?? null };
}

export async function updateNews(id: string, input: NewsInput): Promise<{ error: string | null }> {
  if (supabase === null) return { error: NOT_CONFIGURED };
  const { error } = await supabase
    .from('news')
    .update({
      title: input.title,
      body: input.body,
      severity: input.severity,
      audience_client_id: input.audienceClientId,
      expires_at: input.expiresAt,
    })
    .eq('id', id);
  return { error: error?.message ?? null };
}

export async function deleteNews(id: string): Promise<{ error: string | null }> {
  if (supabase === null) return { error: NOT_CONFIGURED };
  const { error } = await supabase.from('news').delete().eq('id', id);
  return { error: error?.message ?? null };
}
