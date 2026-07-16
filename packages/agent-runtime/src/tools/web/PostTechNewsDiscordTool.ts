import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { aggregateNews, httpGet, toExcerpt, type NewsItem } from './FetchTechNewsTool';
import { htmlToText } from './ReadWebpageTool';
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

// Discord hard limits we must respect.
const MAX_EMBEDS = 10;
const MAX_TITLE = 256;
const MAX_DESC = 4096;
const MAX_CONTENT = 2000;

const BRAND_COLOR = 0x5865f2; // Discord blurple

export interface DiscordEmbed {
  title: string;
  url?: string;
  description?: string;
  color: number;
  footer?: { text: string };
  timestamp?: string;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

// Human "il y a X" for an ISO date (pure, exported for tests).
export function relativeAge(iso: string | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  const mins = Math.round((now - ts) / 60_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

/**
 * Turn news items into Discord embeds (max 10). Each embed's description holds
 * the per-article summary (when provided, aligned by index) followed by a meta
 * line. Pure, exported for tests.
 */
export function buildDiscordEmbeds(
  items: NewsItem[],
  summaries: string[] = [],
  now = Date.now(),
): DiscordEmbed[] {
  return items.slice(0, MAX_EMBEDS).map((item, i) => {
    const meta: string[] = [];
    const age = relativeAge(item.publishedAt, now);
    if (age) meta.push(`🕒 ${age}`);
    if (typeof item.points === 'number') meta.push(`▲ ${item.points}`);
    if (typeof item.comments === 'number') meta.push(`💬 ${item.comments}`);

    const embed: DiscordEmbed = {
      title: truncate(item.title, MAX_TITLE),
      url: item.url,
      color: BRAND_COLOR,
      footer: { text: item.source },
    };

    const descParts: string[] = [];
    const summary = typeof summaries[i] === 'string' ? summaries[i]!.trim() : '';
    if (summary.length > 0) descParts.push(summary);
    if (meta.length > 0) descParts.push(meta.join('  ·  '));
    if (descParts.length > 0) embed.description = truncate(descParts.join('\n\n'), MAX_DESC);

    if (item.publishedAt && !Number.isNaN(Date.parse(item.publishedAt))) {
      embed.timestamp = new Date(item.publishedAt).toISOString();
    }
    return embed;
  });
}

/**
 * Best-effort: fetch the linked page for items missing an excerpt (e.g. Hacker
 * News links) and derive a short teaser. Failures are silent — the item simply
 * keeps no excerpt. Runs in parallel; bounded by the small post limit (≤10).
 */
export async function enrichExcerpts(items: NewsItem[]): Promise<NewsItem[]> {
  await Promise.allSettled(
    items.map(async item => {
      if (item.excerpt && item.excerpt.length > 0) return;
      try {
        const html = await httpGet(item.url, 8_000);
        const text = htmlToText(html);
        if (text.length > 80) item.excerpt = toExcerpt(text, 500);
      } catch {
        /* leave without excerpt */
      }
    }),
  );
  return items;
}

/**
 * Lecture du corps des articles : télécharge CHAQUE page liée et en garde le
 * texte principal (plafonné à `maxChars`), pour donner au LLM bien plus de
 * matière que le seul extrait RSS. Complète aussi l'extrait manquant au
 * passage (une seule requête par article). Best-effort en parallèle : un
 * échec (timeout, paywall) laisse l'item avec son extrait d'origine.
 */
export async function enrichArticleTexts(items: NewsItem[], maxChars = 1500): Promise<NewsItem[]> {
  await Promise.allSettled(
    items.map(async item => {
      try {
        const html = await httpGet(item.url, 8_000);
        const text = htmlToText(html);
        // Sous ~200 caractères, on est face à un paywall ou un mur de cookies :
        // l'extrait RSS fait alors meilleure matière que ce résidu.
        if (text.length < 200) return;
        item.fullText = toExcerpt(text, maxChars);
        if (!item.excerpt || item.excerpt.length === 0) item.excerpt = toExcerpt(text, 500);
      } catch {
        /* garde l'extrait RSS */
      }
    }),
  );
  return items;
}

export async function postToDiscord(
  url: string,
  payload: unknown,
): Promise<{ status: number; text: string }> {
  const { default: https } = await import('https');
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
          'User-Agent': 'catdesk-agent/1.0',
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf-8') }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error('Webhook timeout'));
    });
    req.write(body);
    req.end();
  });
}

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
