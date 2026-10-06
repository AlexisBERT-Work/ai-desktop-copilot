/**
 * Expurgation des arguments d'outil avant journalisation (audit).
 *
 * Le journal d'audit ne masquait que deux cas (contenu de write_file et
 * write_clipboard) : le mot de passe IMAP de read_email, les tokens GitHub /
 * Notion / call_api, les chaînes de connexion SQL (mot de passe inclus), les
 * webhooks (secret dans l'URL) et le texte saisi par browser_type (souvent un
 * identifiant) y étaient écrits en clair, sur disque, pour toujours.
 *
 * Règle : on masque par NOM de clé, quel que soit l'outil — un nouvel outil
 * qui prend un `password` est couvert sans y penser. Pur.
 */

/** Clés dont la valeur est un secret : remplacée par un marqueur. */
const SECRET_KEY =
  /pass(?:word|wd)?$|^pwd$|token|secret|api[_-]?key|authorization|cookie|connection_string|webhook|dsn/i;

/** Clés dont la valeur est du contenu utilisateur volumineux : seule sa taille est gardée. */
const CONTENT_KEYS = new Set(['content', 'text', 'body']);

const REDACTED = '[REDACTED]';

function redactValue(key: string, value: unknown): unknown {
  if (SECRET_KEY.test(key)) return value === undefined || value === '' ? value : REDACTED;
  if (CONTENT_KEYS.has(key) && typeof value === 'string') return `[${value.length} chars]`;
  if (key === 'headers' && value !== null && typeof value === 'object') {
    return redactArgs(value as Record<string, unknown>);
  }
  return value;
}

export function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) out[key] = redactValue(key, value);
  return out;
}
