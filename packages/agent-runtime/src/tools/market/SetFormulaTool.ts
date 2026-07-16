import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import type { MarketService } from '../../market/MarketService';

const argsSchema = z.object({
  name: z.string().min(1).describe('Nom lisible de la formule, ex. "ratio_AAPL_MSFT"'),
  expression: z
    .string()
    .min(1)
    .describe(
      'Expression mathjs sur les cotations, ex. "AAPL.price / MSFT.price" ou "max(AAPL.changePercent, MSFT.changePercent)"',
    ),
  id: z.string().optional().describe("Optionnel : id d'une formule existante à modifier"),
});
type Args = z.infer<typeof argsSchema>;

export class SetFormulaTool extends BaseTool<Args> {
  readonly name = 'set_formula';
  readonly description =
    'Crée ou modifie une formule recalculée en direct sur les cotations (langage mathjs, ex. "AAPL.price / MSFT.price"). Champs par symbole : price, change, changePercent, volume.';
  readonly category = 'analysis' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private readonly market: MarketService) {
    super();
  }

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { name, expression, id } = rawArgs;
    if (!name?.trim()) return this.fail('name est requis');
    if (!expression?.trim()) return this.fail('expression est requise');
    const cell = this.market.setFormula(name.trim(), expression.trim(), id);
    return this.ok({ formula: cell, snapshot: this.market.snapshot() });
  }
}
