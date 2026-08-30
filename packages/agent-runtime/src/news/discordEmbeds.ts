import type { DiscordEmbed } from '../lib/discord';
import type { NewsItem } from './newsItem';

export const MAX_EMBEDS = 10;
export const MAX_TITLE = 256;
export const MAX_DESC = 4096;
export const MAX_CONTENT = 2000;

const BRAND_COLOR = 0x5865f2; // Discord blurple

export function truncate(s: string, max: number): string {
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
