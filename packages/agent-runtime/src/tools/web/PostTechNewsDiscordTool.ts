import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { aggregateNews } from '../../news/aggregate';
import { enrichExcerpts } from '../../news/enrich';
import { buildDiscordEmbeds, MAX_CONTENT, MAX_EMBEDS, truncate } from '../../news/discordEmbeds';
import { postToDiscord } from '../../lib/discord';
import type { OllamaClient } from '../../llm/OllamaClient';
import { summarizeDigest } from '../../llm/NewsSummarizer';
import { createLogger } from '../../logger';

const log = createLogger('tool:tech-news-discord');

const argsSchema = z.object({
  sources: z
    .array(z.string())
    .optional()
    .describe('Source ids (defaults to a balanced mix). Same ids as fetch_tech_news'),
  feeds: z
    .array(z.string())
    .optional()
    .describe('Custom RSS/Atom feed URLs to include, e.g. ["https://blog.rust-lang.org/feed.xml"]'),
  topics: z
    .array(z.string())
    .optional()
    .describe('Keywords to filter by (matches title or excerpt) (optional)'),
  since_hours: z
    .number()
    .default(24)
    .describe('Only keep articles published within this many hours (0 = no limit)'),
  limit: z.number().default(8).describe('Number of articles to post as Discord embeds (1-10)'),
  lang: z.enum(['fr', 'en', 'all']).default('all').describe('Restrict sources to a language'),
  intro: z
    .string()
    .optional()
    .describe(
      'Short intro line posted above the articles (optional — a default header is used otherwise)',
    ),
  webhook_url: z
    .string()
    .optional()
    .describe('Discord incoming webhook URL (falls back to DISCORD_WEBHOOK_URL env var)'),
  username: z.string().optional().describe('Override the displayed sender name (optional)'),
});
type Args = z.infer<typeof argsSchema>;

/**
 * Fetch → format embeds → post to Discord in one atomic call. Designed to be
 * driven by a daily scheduled job (autonomous, no LLM hand-off needed), so it
 * is bounded to posting a news digest to the pre-configured webhook only —
 * hence `medium` risk without a blocking confirmation prompt.
 */
export class PostTechNewsDiscordTool extends BaseTool<Args> {
  readonly name = 'post_tech_news_discord';
  readonly description =
    'Récupère les actualités tech du jour, génère une synthèse quotidienne et un résumé par article (via le LLM local), et les publie en embeds cliquables sur un webhook Discord. Tout-en-un (fetch + résumés + envoi) — idéal pour une revue de presse quotidienne planifiée. URL via `webhook_url` ou la variable DISCORD_WEBHOOK_URL.';
  readonly category = 'web' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(
    private readonly llm: OllamaClient,
    private readonly model: string,
  ) {
    super();
  }

  async execute(args: Args): Promise<ToolResult> {
    const {
      sources,
      feeds,
      topics = [],
      since_hours = 24,
      limit = 8,
      lang = 'all',
      intro,
      username,
    } = args;

    const webhookUrl = (args.webhook_url ?? process.env['DISCORD_WEBHOOK_URL'] ?? '').trim();
    if (webhookUrl.length === 0) {
      return this.fail(
        'URL de webhook Discord manquante. Passe webhook_url ou définis DISCORD_WEBHOOK_URL.',
      );
    }
    if (!/^https:\/\//i.test(webhookUrl)) {
      return this.fail('webhook_url doit être une URL https valide.');
    }

    let result;
    try {
      result = await aggregateNews({
        sources,
        feeds,
        topics,
        sinceHours: since_hours,
        limit: Math.min(Math.max(1, limit), MAX_EMBEDS),
        lang,
      });
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : String(err));
    }

    if (result.items.length === 0) {
      return this.fail(
        `Aucun article à publier. ${result.failed.length > 0 ? `Erreurs sources: ${result.failed.join(' | ')}` : "Essaie d'élargir since_hours ou de retirer les filtres topics."}`.trim(),
      );
    }

    // Fill in missing excerpts (mostly Hacker News links), then ask the LLM for
    // a daily synthesis + one summary per article in a single call. Both steps
    // degrade gracefully: the digest is still posted if either is incomplete.
    await enrichExcerpts(result.items);
    const { synthesis, summaries } = await summarizeDigest(this.llm, this.model, result.items);

    const embeds = buildDiscordEmbeds(result.items, summaries);
    const header =
      typeof intro === 'string' && intro.trim().length > 0
        ? intro.trim()
        : `📰 **Revue de presse tech** — ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${embeds.length} articles`;
    const content = truncate(
      synthesis.length > 0 ? `${header}\n\n${synthesis}` : header,
      MAX_CONTENT,
    );

    const payload: Record<string, unknown> = {
      content,
      embeds,
      ...(typeof username === 'string' && username.length > 0 ? { username } : {}),
    };

    let res: { status: number; text: string };
    try {
      res = await postToDiscord(webhookUrl, payload);
    } catch (err) {
      return this.fail(`Échec de l'envoi au webhook Discord: ${String(err)}`);
    }

    if (res.status >= 200 && res.status < 300) {
      log.info('Tech news digest posted to Discord', {
        posted: embeds.length,
        hadSynthesis: synthesis.length > 0,
      });
      return this.ok({
        delivered: true,
        status: res.status,
        posted: embeds.length,
        hadSynthesis: synthesis.length > 0,
        sources: result.sourceLabels,
        ...(result.failed.length > 0 ? { partialErrors: result.failed } : {}),
      });
    }
    return this.fail(`Discord a répondu ${res.status}: ${res.text.slice(0, 300)}`);
  }
}
