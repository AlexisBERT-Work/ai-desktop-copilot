import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import type { MarketService } from '../../market/MarketService';

export class GetMarketTool extends BaseTool {
  readonly name = 'get_market';
  readonly description =
    "Renvoie l'instantané bourse courant : cotations de la watchlist + valeurs des formules. Rafraîchit avant de répondre.";
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.get_market;

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
