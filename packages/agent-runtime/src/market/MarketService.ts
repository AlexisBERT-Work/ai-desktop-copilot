import { fetchQuotes } from './YahooQuoteSource';
import { buildScope, evaluateFormula } from './FormulaEngine';
import type {
  ComputedValue,
  FormulaCell,
  MarketSnapshot,
  Quote,
  WatchlistItem,
} from '@catdesk/shared-types';

const HISTORY_CAP = 120; // ~1 h à 30 s/tick

function uniqueUpper(symbols: string[]): string[] {
  return [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0))];
}

/**
 * État du module bourse : watchlist, formules, dernières cotations et un court
 * historique de prix par symbole. `refresh()` va chercher les cotations et
 * recalcule les formules ; `snapshot()` renvoie l'instantané à pousser à l'UI.
 */
export class MarketService {
  private symbols: string[];
  private formulas: FormulaCell[] = [];
  private readonly quotes = new Map<string, Quote>();
  private readonly history = new Map<string, number[]>();

  constructor(seedSymbols: string[] = []) {
    this.symbols = uniqueUpper(seedSymbols);
  }

  getWatchlist(): WatchlistItem[] {
    return this.symbols.map((symbol) => ({ symbol }));
  }

  getFormulas(): FormulaCell[] {
    return [...this.formulas];
  }

  getHistory(symbol: string): number[] {
    return [...(this.history.get(symbol.trim().toUpperCase()) ?? [])];
  }

  addSymbol(symbol: string): void {
    this.symbols = uniqueUpper([...this.symbols, symbol]);
  }

  removeSymbol(symbol: string): void {
    const up = symbol.trim().toUpperCase();
    this.symbols = this.symbols.filter((s) => s !== up);
    this.quotes.delete(up);
    this.history.delete(up);
  }

  /** Remplace toute la watchlist (source de vérité = widgets de l'UI). */
  setWatchlist(symbols: string[]): void {
    const next = uniqueUpper(symbols);
    const keep = new Set(next);
    for (const s of this.symbols) {
      if (!keep.has(s)) {
        this.quotes.delete(s);
        this.history.delete(s);
      }
    }
    this.symbols = next;
  }

  setFormula(name: string, expression: string, id?: string): FormulaCell {
    const cell: FormulaCell = { id: id ?? crypto.randomUUID(), name, expression };
    const idx = this.formulas.findIndex((f) => f.id === cell.id);
    if (idx >= 0) this.formulas[idx] = cell;
    else this.formulas.push(cell);
    return cell;
  }

  removeFormula(id: string): void {
    this.formulas = this.formulas.filter((f) => f.id !== id);
  }

  /** Remplace toutes les formules (source de vérité = widgets de l'UI). */
  setFormulas(defs: { name: string; expression: string }[]): void {
    this.formulas = defs
      .filter((d) => d.name.trim().length > 0 && d.expression.trim().length > 0)
      .map((d) => ({ id: crypto.randomUUID(), name: d.name.trim(), expression: d.expression.trim() }));
  }

  /** Récupère les cotations, met à jour cache + historique, renvoie l'instantané. */
  async refresh(): Promise<MarketSnapshot> {
    if (this.symbols.length > 0) {
      const fetched = await fetchQuotes(this.symbols);
      for (const symbol of this.symbols) {
        const q = fetched.get(symbol);
        if (q !== undefined) {
          this.quotes.set(symbol, q);
          const h = this.history.get(symbol) ?? [];
          h.push(q.price);
          if (h.length > HISTORY_CAP) h.shift();
          this.history.set(symbol, h);
        } else {
          const prev = this.quotes.get(symbol);
          if (prev !== undefined) this.quotes.set(symbol, { ...prev, stale: true });
        }
      }
    }
    return this.snapshot();
  }

  snapshot(): MarketSnapshot {
    const quotes = this.symbols
      .map((s) => this.quotes.get(s))
      .filter((q): q is Quote => q !== undefined);

    const scope = buildScope(quotes);
    const computed: ComputedValue[] = this.formulas.map((f) => {
      const r = evaluateFormula(f.expression, scope);
      return r.error !== undefined
        ? { id: f.id, name: f.name, value: r.value, error: r.error }
        : { id: f.id, name: f.name, value: r.value };
    });

    // Historique récent (≤ 40 points) par symbole, pour les sparklines.
    const history: Record<string, number[]> = {};
    for (const s of this.symbols) {
      const h = this.history.get(s);
      if (h !== undefined && h.length > 0) history[s] = h.slice(-40);
    }

    return { quotes, computed, history, timestamp: Date.now() };
  }
}
