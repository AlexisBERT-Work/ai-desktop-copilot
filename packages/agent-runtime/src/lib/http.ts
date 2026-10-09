// Client HTTP unique du runtime, sur le `fetch` natif de Node (≥ 20).
//
// Six clients faits main (http/https bruts) cohabitaient : httpGet, le POST
// Discord, celui de send_webhook_message, la requête de call_api, celle de
// read_webpage, et les wrappers GitHub/Notion. Chacun réimplémentait — ou
// oubliait — le délai, le plafond de taille et les redirections : read_webpage
// cassait sur une redirection relative et pouvait boucler sans fin. `fetch`
// suit les redirections (relatives comprises, 20 sauts max) ; ce module ajoute
// ce qu'il ne fait pas : délai par défaut et lecture bornée du corps.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpRequest {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
  /** Délai de la requête ENTIÈRE, corps compris (défaut 15 s). */
  timeoutMs?: number;
  /** Plafond du corps lu ; au-delà, la requête échoue (défaut 6 Mo). */
  maxBytes?: number;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 6_000_000;

/** User-Agent des appels d'API (GitHub, Notion, webhooks). */
export const API_USER_AGENT = 'catdesk-agent/1.0';

/** User-Agent des pages web et flux de presse : certains sites refusent un UA d'API. */
export const BROWSER_USER_AGENT = 'Mozilla/5.0 (compatible; CatDesk-Agent/1.0)';

/**
 * Effectue une requête et lit le corps en texte, borné à `maxBytes`. Ne lève
 * PAS sur un statut HTTP d'erreur (l'appelant décide) ; lève sur une erreur
 * réseau, un délai dépassé ou un corps trop volumineux.
 */
export async function httpRequest(url: string, req: HttpRequest = {}): Promise<HttpResponse> {
  const res = await fetch(url, {
    method: req.method ?? 'GET',
    headers: req.headers ?? {},
    ...(req.body !== undefined ? { body: req.body } : {}),
    signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  const text = await readBounded(res, req.maxBytes ?? DEFAULT_MAX_BYTES);
  return { status: res.status, ok: res.ok, headers: res.headers, text };
}

async function readBounded(res: Response, maxBytes: number): Promise<string> {
  if (res.body === null) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Réponse trop volumineuse (> ${Math.round(maxBytes / 1_000_000)} Mo)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * GET d'une page ou d'un flux, en texte. Lève sur un statut ≥ 400 — c'est le
 * contrat attendu par le pipeline presse, qui compte une source en échec.
 */
export async function httpGet(url: string, timeoutMs = 12_000): Promise<string> {
  const res = await httpRequest(url, {
    timeoutMs,
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      Accept:
        'application/json, application/rss+xml, application/atom+xml, text/xml;q=0.9, */*;q=0.8',
      'Accept-Language': 'fr,en;q=0.8',
    },
  });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return res.text;
}

/** POST d'un corps JSON ; renvoie statut + texte de réponse, sans lever sur un statut d'erreur. */
export async function postJson(
  url: string,
  payload: unknown,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<{ status: number; text: string }> {
  const res = await httpRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': API_USER_AGENT,
      ...opts.headers,
    },
    body: JSON.stringify(payload),
    timeoutMs: opts.timeoutMs ?? 10_000,
  });
  return { status: res.status, text: res.text };
}

/**
 * Requête d'API JSON : le corps de réponse est parsé, quel que soit le statut
 * (GitHub et Notion décrivent leurs erreurs dans un JSON). Lève si le corps
 * n'est pas du JSON, avec `label` pour situer l'API fautive.
 */
export async function fetchJson(url: string, req: HttpRequest, label: string): Promise<unknown> {
  const res = await httpRequest(url, req);
  try {
    return JSON.parse(res.text) as unknown;
  } catch {
    throw new Error(`Invalid JSON from ${label} (HTTP ${res.status})`);
  }
}
