import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDailyCategory, type DailyCategory, type PressFeed, type PressFeedInput } from '@catdesk/shared-types';
import { createLogger } from '../logger';

const log = createLogger('news:local-feeds');

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
}

function asCategory(x: unknown): DailyCategory {
  return isDailyCategory(x) ? x : 'misc';
}

function asPositiveInt(x: unknown, fallback: number): number {
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Répare une entrée persistée potentiellement obsolète/corrompue. Pur, exporté pour tests. */
export function sanitizeFeed(r: Record<string, unknown>): PressFeed | null {
  const id = typeof r['id'] === 'string' && r['id'].length > 0 ? r['id'] : null;
  const name = typeof r['name'] === 'string' ? r['name'].trim() : '';
  if (id === null || name.length === 0) return null;
  const includeRegex =
    typeof r['includeRegex'] === 'string' && r['includeRegex'].length > 0 ? r['includeRegex'] : null;
  const excludeRegex =
    typeof r['excludeRegex'] === 'string' && r['excludeRegex'].length > 0 ? r['excludeRegex'] : null;
  return {
    id,
    name,
    category: asCategory(r['category']),
    sourceIds: asStringArray(r['sourceIds']),
    feedUrls: asStringArray(r['feedUrls']),
    includeKeywords: asStringArray(r['includeKeywords']),
    includeRegex,
    excludeRegex,
    sinceHours: asPositiveInt(r['sinceHours'], 24),
    articleLimit: asPositiveInt(r['articleLimit'], 12),
    enabled: r['enabled'] !== false,
  };
}

/**
 * Journaux personnalisés DE CE POSTE — stockés en JSON dans le dossier de
 * données de l'agent, sans dépendance à Supabase ni au rôle admin. L'utilisateur
 * les gère depuis l'UI (panneau « Mes journaux ») via le bridge stdin.
 */
export class LocalPressFeedStore {
  private readonly path: string;
  private feeds: PressFeed[] = [];

  constructor(dataDir: string) {
    this.path = join(dataDir, 'press-feeds.json');
    this.load();
    log.info('LocalPressFeedStore initialized', { path: this.path, count: this.feeds.length });
  }

  list(): PressFeed[] {
    return [...this.feeds];
  }

  /** Crée (sans id) ou met à jour (avec id) un journal. Renvoie l'entrée persistée. */
  save(input: PressFeedInput & { id?: string }): PressFeed {
    const sanitized = sanitizeFeed({ ...input, id: input.id ?? randomUUID() });
    if (sanitized === null) throw new Error('Journal invalide : nom requis.');
    const idx = this.feeds.findIndex((f) => f.id === sanitized.id);
    if (idx === -1) this.feeds.push(sanitized);
    else this.feeds[idx] = sanitized;
    this.persist();
    log.info('Local feed saved', { id: sanitized.id, name: sanitized.name });
    return sanitized;
  }

  delete(id: string): boolean {
    const before = this.feeds.length;
    this.feeds = this.feeds.filter((f) => f.id !== id);
    if (this.feeds.length === before) return false;
    this.persist();
    log.info('Local feed deleted', { id });
    return true;
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      if (Array.isArray(raw)) {
        this.feeds = raw
          .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
          .map(sanitizeFeed)
          .filter((f): f is PressFeed => f !== null);
      }
    } catch (err) {
      log.warn('Local feeds unreadable — starting empty', { error: String(err) });
      this.feeds = [];
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.feeds, null, 2), 'utf8');
  }
}
