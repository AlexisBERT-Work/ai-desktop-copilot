import type { DailyCategory } from '@catdesk/shared-types';
import { DAILY_CATEGORY_LABEL } from '@catdesk/shared-types';
import type { JournalDraft } from './pressDigest';
import { postToDiscord, type DiscordEmbed } from '../tools/web/PostTechNewsDiscordTool';
import { createLogger } from '../logger';

const log = createLogger('news:discord-daily');

// Limites dures Discord (mêmes contraintes que le publieur tech).
const MAX_EMBEDS = 10;
const MAX_TITLE = 256;
const MAX_DESC = 4096;
const MAX_CONTENT = 2000;
// Total cumulé (titre + description + footer) de TOUS les embeds d'un message.
const MAX_EMBED_TOTAL = 6000;

/** Couleur de la barre d'embed par catégorie (repli : blurple). */
const CATEGORY_COLOR: Record<DailyCategory, number> = {
  markets: 0x16a34a, // vert
  tech: 0x5865f2, // blurple
  crypto: 0xf59e0b, // ambre
  macro: 0x0ea5e9, // cyan
  product: 0xa855f7, // violet
  misc: 0x6b7280, // gris
};

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/** Découpe une liste en tranches de `size`. Pur, exporté pour tests. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Taille d'un embed telle que comptée par Discord (titre + description + footer). */
export function embedSize(e: DiscordEmbed): number {
  return (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0);
}

/**
 * Regroupe les embeds en lots respectant les DEUX limites Discord : au plus
 * `MAX_EMBEDS` embeds ET `MAX_EMBED_TOTAL` caractères cumulés par message —
 * dépasser l'une ou l'autre vaut un 400. Pur, exporté pour tests.
 */
export function batchEmbeds(embeds: DiscordEmbed[]): DiscordEmbed[][] {
  const out: DiscordEmbed[][] = [];
  let batch: DiscordEmbed[] = [];
  let size = 0;
  for (const e of embeds) {
    const s = embedSize(e);
    if (batch.length > 0 && (batch.length >= MAX_EMBEDS || size + s > MAX_EMBED_TOTAL)) {
      out.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(e);
    size += s;
  }
  if (batch.length > 0) out.push(batch);
  return out;
}

/**
 * Une daily (JournalDraft) → un embed Discord. Le corps Markdown devient la
 * description (liens `[titre](url)` rendus tels quels par Discord), tronquée à
 * la limite. Pur, exporté pour tests.
 */
export function draftToEmbed(draft: JournalDraft): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: truncate(draft.title, MAX_TITLE),
    color: CATEGORY_COLOR[draft.category] ?? 0x5865f2,
    footer: { text: DAILY_CATEGORY_LABEL[draft.category] ?? draft.category },
    timestamp: new Date().toISOString(),
  };
  const body = draft.body.trim();
  if (body.length > 0) embed.description = truncate(body, MAX_DESC);
  return embed;
}

/** En-tête du message (une par lot). Pur. */
export function dailyHeader(count: number, now = new Date()): string {
  const date = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const plural = count > 1 ? 's' : '';
  return truncate(`📊 **Dailys du ${date}** · ${count} briefing${plural}`, MAX_CONTENT);
}

export interface DiscordPublishResult {
  posted: number;
  batches: number;
  errors: string[];
}

/**
 * Miroite les dailys publiées sur Supabase vers un webhook Discord. Un embed par
 * daily, en lots de 10 (limite Discord). Best-effort : une erreur de lot n'arrête
 * pas les suivants. N'est appelée qu'avec les drafts *réellement* insérés par
 * `publishDailies`, donc l'idempotence Supabase évite les doublons Discord.
 */
export async function publishDailiesToDiscord(
  webhookUrl: string,
  drafts: JournalDraft[],
  opts: { username?: string; now?: Date } = {},
): Promise<DiscordPublishResult> {
  const result: DiscordPublishResult = { posted: 0, batches: 0, errors: [] };
  if (drafts.length === 0) return result;

  for (const batch of batchEmbeds(drafts.map(draftToEmbed))) {
    const payload: Record<string, unknown> = {
      content: dailyHeader(batch.length, opts.now),
      embeds: batch,
      ...(opts.username && opts.username.length > 0 ? { username: opts.username } : {}),
    };
    try {
      const res = await postToDiscord(webhookUrl, payload);
      if (res.status >= 200 && res.status < 300) {
        result.posted += batch.length;
        result.batches += 1;
      } else {
        result.errors.push(`Discord ${res.status}: ${res.text.slice(0, 200)}`);
      }
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  log.info('Dailys mirrored to Discord', {
    posted: result.posted,
    batches: result.batches,
    errors: result.errors.length,
    // Sans le détail, un échec est indiagnosticable depuis les logs.
    ...(result.errors.length > 0 ? { firstError: result.errors[0] } : {}),
  });
  return result;
}
