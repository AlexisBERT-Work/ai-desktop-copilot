import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { aggregateNews, type AggregateResult } from '../../news/aggregate';

const argsSchema = z.object({
  sources: z
    .array(z.string())
    .optional()
    .describe(
      'Source ids to query (defaults to a balanced mix). Available: hackernews, devto, theverge, arstechnica, techcrunch, hackernoon, numerama, nextinpact, lesnumeriques',
    ),
  feeds: z
    .array(z.string())
    .optional()
    .describe(
      'Custom RSS/Atom feed URLs to include, e.g. ["https://blog.rust-lang.org/feed.xml"]. Added on top of (or instead of) the predefined sources',
    ),
  topics: z
    .array(z.string())
    .optional()
    .describe(
      'Keywords to filter by (matches title or excerpt), e.g. ["AI", "rust", "react"] (optional — no filter if omitted)',
    ),
  since_hours: z
    .number()
    .default(24)
    .describe('Only keep articles published within this many hours (0 = no limit)'),
  limit: z.number().default(15).describe('Max number of articles to return (1-50)'),
  lang: z
    .enum(['fr', 'en', 'all'])
    .default('all')
    .describe('Restrict predefined sources to a language (custom feeds are always included)'),
});
type Args = z.infer<typeof argsSchema>;

// ─── Tool ─────────────────────────────────────────────────────

export class FetchTechNewsTool extends BaseTool<Args> {
  readonly name = 'fetch_tech_news';
  readonly description =
    'Agrège les actualités tech du jour depuis plusieurs sources gratuites (Hacker News, The Verge, TechCrunch, DEV.to, Ars Technica + sources FR : Numerama, Next, Les Numériques) et/ou des flux RSS/Atom personnalisés via `feeds`. Filtre par sujets (titre ou extrait) et fenêtre temporelle, déduplique et classe les articles. Le LLM rédige ensuite une synthèse + un résumé par article.';
  readonly category = 'web' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(args: Args): Promise<ToolResult> {
    const { sources, feeds, topics = [], since_hours = 24, limit = 15, lang = 'all' } = args;

    let result: AggregateResult;
    try {
      result = await aggregateNews({
        sources,
        feeds,
        topics,
        sinceHours: since_hours,
        limit,
        lang,
      });
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : String(err));
    }

    if (result.totalFetched === 0) {
      return this.fail(
        `Impossible de récupérer des articles. ${result.failed.length > 0 ? `Erreurs: ${result.failed.join(' | ')}` : ''}`.trim(),
      );
    }

    return this.ok({
      generatedAt: new Date().toISOString(),
      sources: result.sourceLabels,
      ...(topics && topics.length > 0 ? { topics } : {}),
      sinceHours: since_hours,
      count: result.items.length,
      totalFetched: result.totalFetched,
      items: result.items,
      ...(result.failed.length > 0 ? { partialErrors: result.failed } : {}),
      note: "Brouillon de revue de presse. Le LLM doit produire, en français : (1) une SYNTHÈSE quotidienne de 2-4 phrases dégageant les tendances du jour, puis (2) pour CHAQUE article, un résumé d'une phrase basé sur son `excerpt` (titre + source + lien conservés).",
    });
  }
}
