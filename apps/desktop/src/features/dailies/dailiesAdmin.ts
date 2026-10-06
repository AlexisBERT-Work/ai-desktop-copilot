import type { Daily, DailyCategory } from '@catdesk/shared-types';
import { makeTableCrud } from '../news/supabaseCrud';
import { rowToDaily, type DailyRow } from './model';

/** Données saisies à la création/édition d'une daily. */
export interface DailyInput {
  title: string;
  body: string;
  category: DailyCategory;
  /** ISO 8601 ou null (pas d'expiration). */
  expiresAt: string | null;
}

/**
 * CRUD des dailys — réservé à l'admin : la policy `dailies_admin_write`
 * (for all) lui ouvre aussi la lecture intégrale, expirées comprises.
 */
/** Backend CRUD complet — consommé tel quel par `useCrudConsole`. */
export const dailiesCrud = makeTableCrud<DailyRow, Daily, DailyInput>({
  table: 'dailies',
  toModel: rowToDaily,
  toRow: input => ({
    title: input.title,
    body: input.body,
    category: input.category,
    expires_at: input.expiresAt,
  }),
});

export const listAllDailies = dailiesCrud.listAll;
export const createDaily = dailiesCrud.create;
export const updateDaily = dailiesCrud.update;
export const deleteDaily = dailiesCrud.remove;
