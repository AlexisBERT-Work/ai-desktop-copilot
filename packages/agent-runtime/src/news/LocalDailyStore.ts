import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Daily } from '@catdesk/shared-types';
import type { JournalDraft } from './pressDigest';
import { createLogger } from '../logger';

const log = createLogger('news:local-dailies');

const MAX_AGE_DAYS = 30;
const CAP = 300;

/**
 * Dailys générées LOCALEMENT par les journaux personnalisés de ce poste.
 * Complètent les dailys partagées (Supabase) dans le widget — l'UI fusionne
 * les deux listes. Idempotence par titre (titres datés), purge par âge et cap.
 */
export class LocalDailyStore {
  private readonly path: string;
  private items: Daily[] = [];

  constructor(dataDir: string) {
    this.path = join(dataDir, 'local-dailies.json');
    this.load();
    log.info('LocalDailyStore initialized', { path: this.path, count: this.items.length });
  }

  list(): Daily[] {
    return [...this.items];
  }

  has(title: string): boolean {
    return this.items.some((d) => d.title === title);
  }

  /** Ajoute les brouillons dont le titre n'existe pas encore. Renvoie les nouveaux. */
  addNew(drafts: JournalDraft[], now = new Date()): Daily[] {
    const added: Daily[] = [];
    for (const draft of drafts) {
      if (this.has(draft.title)) continue;
      added.push({
        id: `local-${randomUUID()}`,
        title: draft.title,
        body: draft.body,
        category: draft.category,
        publishedAt: now.toISOString(),
        expiresAt: null,
      });
    }
    if (added.length > 0) {
      this.items.push(...added);
      this.prune(now);
      this.persist();
    }
    return added;
  }

  /** Purge par âge (30 j) puis par cap (300), les plus récentes d'abord. */
  private prune(now: Date): void {
    const cutoff = now.getTime() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    this.items = this.items
      .filter((d) => {
        const t = Date.parse(d.publishedAt);
        return Number.isNaN(t) || t >= cutoff;
      })
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, CAP);
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      if (Array.isArray(raw)) {
        this.items = raw.filter(
          (d): d is Daily =>
            d !== null &&
            typeof d === 'object' &&
            typeof (d as Daily).id === 'string' &&
            typeof (d as Daily).title === 'string' &&
            typeof (d as Daily).body === 'string' &&
            typeof (d as Daily).publishedAt === 'string',
        );
      }
    } catch (err) {
      log.warn('Local dailies unreadable — starting empty', { error: String(err) });
      this.items = [];
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.items, null, 2), 'utf8');
  }
}
