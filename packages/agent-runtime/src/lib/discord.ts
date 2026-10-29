// Transport Discord : forme d'un embed, validation et envoi vers un webhook.
// Volontairement ignorant du domaine presse — la construction des embeds vit
// dans news/discordEmbeds.ts.

import { postJson } from './http';

export interface DiscordEmbed {
  title: string;
  url?: string;
  description?: string;
  color: number;
  footer?: { text: string };
  timestamp?: string;
}

/**
 * Vrai pour une URL de webhook entrant Discord (`https://discord.com/api/webhooks/…`,
 * variantes ptb/canary et ancien domaine discordapp). Un outil qui poste sans
 * confirmation ne doit pas pouvoir viser n'importe quel serveur : sinon une
 * injection de prompt en fait un canal d'exfiltration.
 */
export function isDiscordWebhookUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    /^(?:(?:ptb|canary)\.)?discord(?:app)?\.com$/i.test(url.hostname) &&
    /^\/api\/webhooks\/\d+\/[\w-]+\/?$/.test(url.pathname)
  );
}

export function postToDiscord(
  url: string,
  payload: unknown,
): Promise<{ status: number; text: string }> {
  return postJson(url, payload);
}
