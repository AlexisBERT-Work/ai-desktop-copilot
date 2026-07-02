import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import type { MarketService } from '../../market/MarketService';

interface Args {
  symbol: string;
}

export class AddToWatchlistTool extends BaseTool {
  readonly name = 'add_to_watchlist';
  readonly description =
    'Ajoute un symbole boursier à la watchlist suivie en direct, puis renvoie l\'instantané rafraîchi.';
  readonly category = 'analysis' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.add_to_watchlist;

  constructor(private readonly market: MarketService) {
    super();
  }

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const { symbol } = rawArgs as Args;
    if (!symbol?.trim()) return this.fail('symbol est requis');
    this.market.addSymbol(symbol);
    try {
      return this.ok(await this.market.refresh());
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : String(err));
    }
  }
}
