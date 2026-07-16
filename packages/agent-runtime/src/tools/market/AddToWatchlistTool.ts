import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import type { MarketService } from '../../market/MarketService';

const argsSchema = z.object({
  symbol: z
    .string()
    .min(1)
    .describe('Ticker à suivre, ex. "AAPL", "MSFT", "MC.PA" (Euronext via suffixe Yahoo)'),
});
type Args = z.infer<typeof argsSchema>;

export class AddToWatchlistTool extends BaseTool<Args> {
  readonly name = 'add_to_watchlist';
  readonly description =
    "Ajoute un symbole boursier à la watchlist suivie en direct, puis renvoie l'instantané rafraîchi.";
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
    this.market.addSymbol(symbol);
    try {
      return this.ok(await this.market.refresh());
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : String(err));
    }
  }
}
