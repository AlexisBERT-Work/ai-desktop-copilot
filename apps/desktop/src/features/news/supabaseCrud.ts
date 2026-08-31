import { supabase } from './supabaseClient';

/**
 * Fabrique de CRUD Supabase pour une table administrée.
 *
 * `dailiesAdmin`, `newsAdmin` et `pressFeedsAdmin` répétaient exactement la
 * même structure : le même message « Supabase non configuré », le même garde
 * `supabase === null`, le même `.select('*').order('published_at')` et le même
 * `{ error: error?.message ?? null }`. Seuls changent le nom de la table, le
 * mapper de ligne et la sérialisation de l'entrée — les trois paramètres ici.
 */
export const NOT_CONFIGURED = 'Supabase non configuré.';

export interface TableCrud<Model, Input> {
  /** Toutes les lignes, y compris expirées (lecture admin). */
  listAll: () => Promise<{ items: Model[]; error: string | null }>;
  create: (input: Input) => Promise<{ error: string | null }>;
  update: (id: string, input: Input) => Promise<{ error: string | null }>;
  remove: (id: string) => Promise<{ error: string | null }>;
}

export function makeTableCrud<Row, Model, Input>(opts: {
  table: string;
  /** snake_case → modèle applicatif. */
  toModel: (row: Row) => Model;
  /** Modèle de formulaire → colonnes. Toutes les colonnes doivent être
   *  présentes, jamais omises : une clé absente laisse Postgres appliquer son
   *  défaut sans que l'appelant l'ait décidé (cf. audience_client_id). */
  toRow: (input: Input) => Record<string, unknown>;
  /** Colonne de tri décroissant du listing. */
  orderBy?: string;
  /** Colonnes ajoutées aux seules mises à jour (ex. `updated_at`). */
  updateExtra?: () => Record<string, unknown>;
}): TableCrud<Model, Input> {
  const { table, toModel, toRow, orderBy = 'published_at', updateExtra } = opts;

  return {
    async listAll() {
      if (supabase === null) return { items: [], error: NOT_CONFIGURED };
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .order(orderBy, { ascending: false });
      if (error) return { items: [], error: error.message };
      return { items: ((data ?? []) as Row[]).map(toModel), error: null };
    },

    async create(input) {
      if (supabase === null) return { error: NOT_CONFIGURED };
      const { error } = await supabase.from(table).insert(toRow(input));
      return { error: error?.message ?? null };
    },

    async update(id, input) {
      if (supabase === null) return { error: NOT_CONFIGURED };
      const patch = { ...toRow(input), ...(updateExtra ? updateExtra() : {}) };
      const { error } = await supabase.from(table).update(patch).eq('id', id);
      return { error: error?.message ?? null };
    },

    async remove(id) {
      if (supabase === null) return { error: NOT_CONFIGURED };
      const { error } = await supabase.from(table).delete().eq('id', id);
      return { error: error?.message ?? null };
    },
  };
}
