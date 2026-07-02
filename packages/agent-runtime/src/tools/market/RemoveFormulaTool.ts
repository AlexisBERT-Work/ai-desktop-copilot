import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import type { MarketService } from '../../market/MarketService';

interface Args {
  id: string;
}

export class RemoveFormulaTool extends BaseTool {
  readonly name = 'remove_formula';
  readonly description = 'Supprime une formule de la watchlist bourse (id via get_market).';
  readonly category = 'analysis' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.remove_formula;

  constructor(private readonly market: MarketService) {
    super();
  }

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const { id } = rawArgs as Args;
    if (!id?.trim()) return this.fail('id est requis');
    this.market.removeFormula(id);
    return this.ok({ formulas: this.market.getFormulas() });
  }
}
