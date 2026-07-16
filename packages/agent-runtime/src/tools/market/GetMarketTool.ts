import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import type { MarketService } from '../../market/MarketService';

const argsSchema = z.object({});
type Args = z.infer<typeof argsSchema>;

export class GetMarketTool extends BaseTool<Args> {
  readonly name = 'get_market';
  readonly description =
    "Renvoie l'instantané bourse courant : cotations de la watchlist + valeurs des formules. Rafraîchit avant de répondre.";
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private readonly market: MarketService) {
    super();
  }

  async execute(): Promise<ToolResult> {
    try {
      return this.ok(await this.market.refresh());
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : String(err));
    }
  }
}
