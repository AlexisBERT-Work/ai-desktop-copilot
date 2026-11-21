import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import {
  WEB_SOURCES,
  searchWeb,
  type WebSearchOptions,
  type WebSearchResult,
  type WebSource,
} from '../../search/webSearch';

const argsSchema = z.object({
  query: z.string().trim().min(2).max(200).describe('Mots-clés à chercher'),
  source: z
    .enum(['tout', ...WEB_SOURCES])
    .default('tout')
    .describe('tout = les quatre sources'),
  days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe('Seulement les N derniers jours (hors Wikipédia)'),
});
type Args = z.infer<typeof argsSchema>;

type Search = (
  query: string,
  sources: readonly WebSource[],
  opts: WebSearchOptions,
) => Promise<WebSearchResult>;

/**
 * Recherche web sans clé (veille du 13/11) : Wikipédia, Hacker News, GitHub,
 * Stack Overflow, voir `search/webSearch.ts`. Risque `low` comme
 * `read_webpage` : des GET vers quatre hôtes fixes, seule la requête sort, et
 * ses données personnelles sont masquées avant. Sortie bornée à 10 résultats
 * et ~1 500 tokens ; `read_webpage` lit ensuite le lien qui compte.
 */
export class SearchWebTool extends BaseTool<Args> {
  readonly name = 'search_web';
  readonly description =
    'Cherche sur le web sans clé (Wikipédia, Hacker News, GitHub, Stack Overflow) : titres, liens, dates.';
  readonly category = 'web' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private readonly search: Search = searchWeb) {
    super();
  }

  async execute(args: Args): Promise<ToolResult> {
    const sources = args.source === 'tout' ? WEB_SOURCES : [args.source];
    const result = await this.search(
      args.query,
      sources,
      args.days === undefined ? {} : { days: args.days },
    );
    if (result.resultats.length > 0) return this.ok(result);
    if (result.echecs !== undefined && result.echecs.length === sources.length) {
      return this.fail(`Recherche web indisponible (${result.echecs.join(' ; ')}).`);
    }
    return this.ok({ ...result, note: 'Aucun résultat : reformuler en mots-clés plus courts.' });
  }
}
