import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import type { MarketService } from '../../market/MarketService';

const argsSchema = z.object({
  symbol: z.string().min(1).describe('Ticker à retirer de la watchlist'),
});
type Args = z.infer<typeof argsSchema>;

export class RemoveFromWatchlistTool extends BaseTool<Args> {
  readonly name = 'remove_from_watchlist';
  readonly description = 'Retire un symbole de la watchlist bourse.';
  readonly category = 'analysis' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private readonly market: MarketService) {
    super();
  }

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { symbol } = rawArgs;
    if (!symbol?.trim()) return this.fail('symbol est requis');
    this.market.removeSymbol(symbol);
    return this.ok({ watchlist: this.market.getWatchlist() });
  }
}
