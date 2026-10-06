import type { NewsItem, NewsSeverity } from '@catdesk/shared-types';
import { makeTableCrud } from './supabaseCrud';
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

/**
 * CRUD des news — réservé à l'admin : la policy `news_admin_write` (for all)
 * lui ouvre aussi la lecture intégrale, expirées et ciblées comprises.
 */
/** Backend CRUD complet — consommé tel quel par `useCrudConsole`. */
export const newsCrud = makeTableCrud<NewsRow, NewsItem, NewsInput>({
  table: 'news',
  toModel: rowToNews,
  toRow: input => ({
    title: input.title,
    body: input.body,
    severity: input.severity,
    // Toujours envoyée explicitement (jamais omise) : une clé absente laisse
    // Postgres appliquer son défaut (NULL = global) sans que l'appelant l'ait
    // décidé — piège vécu en testant l'API à la main. Ici le choix vient
    // TOUJOURS du formulaire (case « tous les postes » cochée par défaut).
    audience_client_id: input.audienceClientId,
    expires_at: input.expiresAt,
  }),
});

export const listAllNews = newsCrud.listAll;
export const createNews = newsCrud.create;
export const updateNews = newsCrud.update;
export const deleteNews = newsCrud.remove;
