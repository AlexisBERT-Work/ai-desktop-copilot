import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../logger';
import { loadSqlJs, type Database } from '../lib/sqljs';

const log = createLogger('market:history');

export interface PricePoint {
  ts: number;
  price: number;
}

/**
 * Persistance SQLite de l'historique des cotations (B6).
 *
 * Le `MarketService` garde un court historique en mémoire pour les sparklines ;
 * ce store conserve les points sur disque pour survivre aux redémarrages et
 * alimenter plus tard les formules glissantes (B1). Plafond de points par
 * symbole réglable via CATDESK_MARKET_HISTORY_CAP (défaut 2880 ≈ 24 h à 30 s).
 */
export class MarketHistoryStore {
  private db: Database | null = null;
  private readonly dbPath: string;
  private readonly capPerSymbol: number;

  constructor(capPerSymbol?: number) {
    const dataDir = process.env['CATDESK_DATA_DIR'] ?? join(process.cwd(), 'data');
    mkdirSync(dataDir, { recursive: true });
    this.dbPath = join(dataDir, 'market.db');
    this.capPerSymbol = Math.max(
      1,
      capPerSymbol ?? Number(process.env['CATDESK_MARKET_HISTORY_CAP'] ?? 2880),
    );
  }

  async initialize(): Promise<void> {
    const SqlJs = await loadSqlJs();
    if (existsSync(this.dbPath)) {
      this.db = new SqlJs.Database(readFileSync(this.dbPath));
    } else {
      this.db = new SqlJs.Database();
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS price_history (
        symbol TEXT NOT NULL,
        ts INTEGER NOT NULL,
        price REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_price_history_symbol_ts
        ON price_history(symbol, ts);
    `);
    this.persist();
    log.info('MarketHistoryStore initialized', { path: this.dbPath, cap: this.capPerSymbol });
  }

  /** Ajoute un lot de points (un tick du poller) puis élague et persiste une fois. */
  appendMany(points: Array<{ symbol: string; price: number; ts?: number }>): void {
    if (this.db === null || points.length === 0) return;
    const now = Date.now();
    for (const p of points) {
      this.db.run(`INSERT INTO price_history (symbol, ts, price) VALUES (?,?,?)`, [
        p.symbol.trim().toUpperCase(),
        p.ts ?? now,
        p.price,
      ]);
    }
    for (const symbol of new Set(points.map(p => p.symbol.trim().toUpperCase()))) {
      this.prune(symbol);
    }
    this.persist();
  }

  /** Derniers `limit` points d'un symbole, du plus ancien au plus récent. */
  load(symbol: string, limit = 120): PricePoint[] {
    if (this.db === null) return [];
    const stmt = this.db.prepare(
      `SELECT ts, price FROM price_history WHERE symbol=? ORDER BY ts DESC LIMIT ?`,
    );
    stmt.bind([symbol.trim().toUpperCase(), limit]);
    const rows: PricePoint[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject() as { ts: number; price: number };
      rows.push({ ts: r.ts, price: r.price });
    }
    stmt.free();
    return rows.reverse();
  }

  /** Historique récent de tous les symboles (pour réamorcer le service au démarrage). */
  loadAll(limitPerSymbol = 120): Map<string, number[]> {
    const result = new Map<string, number[]>();
    if (this.db === null) return result;
    const stmt = this.db.prepare(`SELECT DISTINCT symbol FROM price_history`);
    const symbols: string[] = [];
    while (stmt.step()) {
      symbols.push((stmt.getAsObject() as { symbol: string }).symbol);
    }
    stmt.free();
    for (const s of symbols) {
      const points = this.load(s, limitPerSymbol);
      if (points.length > 0)
        result.set(
          s,
          points.map(p => p.price),
        );
    }
    return result;
  }

  /** Supprime tout l'historique d'un symbole (retiré de la watchlist). */
  deleteSymbol(symbol: string): void {
    if (this.db === null) return;
    this.db.run(`DELETE FROM price_history WHERE symbol=?`, [symbol.trim().toUpperCase()]);
    this.persist();
  }

  private prune(symbol: string): void {
    if (this.db === null) return;
    this.db.run(
      `DELETE FROM price_history WHERE symbol=? AND ts NOT IN (
         SELECT ts FROM price_history WHERE symbol=? ORDER BY ts DESC LIMIT ?
       )`,
      [symbol, symbol, this.capPerSymbol],
    );
  }

  private persist(): void {
    if (this.db === null) return;
    try {
      writeFileSync(this.dbPath, Buffer.from(this.db.export()));
    } catch {
      // Non-fatal : on retentera au prochain tick.
    }
  }

  close(): void {
    if (this.db === null) return;
    this.persist();
    this.db.close();
    this.db = null;
  }
}
