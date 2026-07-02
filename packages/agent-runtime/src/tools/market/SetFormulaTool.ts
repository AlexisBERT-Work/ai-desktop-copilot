import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import type { MarketService } from '../../market/MarketService';

interface Args {
  name: string;
  expression: string;
  id?: string;
}

export class SetFormulaTool extends BaseTool {
  readonly name = 'set_formula';
  readonly description =
    'Crée ou modifie une formule recalculée en direct sur les cotations (langage mathjs, ex. "AAPL.price / MSFT.price"). Champs par symbole : price, change, changePercent, volume.';
  readonly category = 'analysis' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.set_formula;

  constructor(private readonly market: MarketService) {
    super();
  }

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const { name, expression, id } = rawArgs as Args;
    if (!name?.trim()) return this.fail('name est requis');
    if (!expression?.trim()) return this.fail('expression est requise');
    const cell = this.market.setFormula(name.trim(), expression.trim(), id);
    return this.ok({ formula: cell, snapshot: this.market.snapshot() });
  }
}
