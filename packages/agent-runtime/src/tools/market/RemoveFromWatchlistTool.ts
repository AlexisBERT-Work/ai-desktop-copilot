import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import type { MarketService } from '../../market/MarketService';

interface Args {
  symbol: string;
}

export class RemoveFromWatchlistTool extends BaseTool {
  readonly name = 'remove_from_watchlist';
  readonly description = 'Retire un symbole de la watchlist bourse.';
  readonly category = 'analysis' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.remove_from_watchlist;

  constructor(private readonly market: MarketService) {
    super();
  }

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const { symbol } = rawArgs as Args;
    if (!symbol?.trim()) return this.fail('symbol est requis');
    this.market.removeSymbol(symbol);
    return this.ok({ watchlist: this.market.getWatchlist() });
  }
}
