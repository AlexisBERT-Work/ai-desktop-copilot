import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PressFeed, PressFeedInput } from '@catdesk/shared-types';
import { createLogger } from '../logger';
import { readJsonFile, writeJsonFile } from '../lib/persistence';
import { pressFeedFromRecord } from './pressFeedRecord';

const log = createLogger('news:local-feeds');

/** Répare une entrée persistée potentiellement obsolète/corrompue. Pur, exporté pour tests. */
export function sanitizeFeed(r: Record<string, unknown>): PressFeed | null {
  return pressFeedFromRecord(r, 'camel');
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
    const idx = this.feeds.findIndex(f => f.id === sanitized.id);
    if (idx === -1) this.feeds.push(sanitized);
    else this.feeds[idx] = sanitized;
    this.persist();
    log.info('Local feed saved', { id: sanitized.id, name: sanitized.name });
    return sanitized;
  }

  delete(id: string): boolean {
    const before = this.feeds.length;
    this.feeds = this.feeds.filter(f => f.id !== id);
    if (this.feeds.length === before) return false;
    this.persist();
    log.info('Local feed deleted', { id });
    return true;
  }

  private load(): void {
    const raw = readJsonFile(this.path, log);
    if (!Array.isArray(raw)) return;
    this.feeds = raw
      .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
      .map(sanitizeFeed)
      .filter((f): f is PressFeed => f !== null);
  }

  private persist(): void {
    writeJsonFile(this.path, this.feeds, log, true);
  }
}
