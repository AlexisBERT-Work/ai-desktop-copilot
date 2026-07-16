import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import type { MarketService } from '../../market/MarketService';

const argsSchema = z.object({
  id: z.string().min(1).describe('Id de la formule à supprimer (voir get_market)'),
});
type Args = z.infer<typeof argsSchema>;

export class RemoveFormulaTool extends BaseTool<Args> {
  readonly name = 'remove_formula';
  readonly description = 'Supprime une formule de la watchlist bourse (id via get_market).';
  readonly category = 'analysis' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private readonly market: MarketService) {
    super();
  }

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { id } = rawArgs;
    if (!id?.trim()) return this.fail('id est requis');
    this.market.removeFormula(id);
    return this.ok({ formulas: this.market.getFormulas() });
  }
}
