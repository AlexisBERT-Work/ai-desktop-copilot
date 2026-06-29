import { isDailyCategory, type Daily, type DailyCategory } from '@catdesk/shared-types';
import { supabase } from '../news/supabaseClient';

/** Données saisies à la création/édition d'une daily. */
export interface DailyInput {
  title: string;
  body: string;
  category: DailyCategory;
  /** ISO 8601 ou null (pas d'expiration). */
  expiresAt: string | null;
}

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

const NOT_CONFIGURED = 'Supabase non configuré.';

/**
 * Toutes les dailys (y compris expirées) — réservé à l'admin : la policy
 * `dailies_admin_write` (for all) lui ouvre aussi la lecture intégrale.
 */
export async function listAllDailies(): Promise<{ items: Daily[]; error: string | null }> {
  if (supabase === null) return { items: [], error: NOT_CONFIGURED };
  const { data, error } = await supabase
    .from('dailies')
    .select('*')
    .order('published_at', { ascending: false });
  if (error) return { items: [], error: error.message };
  return { items: ((data ?? []) as DailyRow[]).map(rowToDaily), error: null };
}

export async function createDaily(input: DailyInput): Promise<{ error: string | null }> {
  if (supabase === null) return { error: NOT_CONFIGURED };
  const { error } = await supabase.from('dailies').insert({
    title: input.title,
    body: input.body,
    category: input.category,
    expires_at: input.expiresAt,
  });
  return { error: error?.message ?? null };
}

export async function updateDaily(id: string, input: DailyInput): Promise<{ error: string | null }> {
  if (supabase === null) return { error: NOT_CONFIGURED };
  const { error } = await supabase
    .from('dailies')
    .update({
      title: input.title,
      body: input.body,
      category: input.category,
      expires_at: input.expiresAt,
    })
    .eq('id', id);
  return { error: error?.message ?? null };
}

export async function deleteDaily(id: string): Promise<{ error: string | null }> {
  if (supabase === null) return { error: NOT_CONFIGURED };
  const { error } = await supabase.from('dailies').delete().eq('id', id);
  return { error: error?.message ?? null };
}
