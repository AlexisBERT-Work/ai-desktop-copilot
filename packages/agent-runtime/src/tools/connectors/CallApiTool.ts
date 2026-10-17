import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { API_USER_AGENT, httpRequest, type HttpResponse } from '../../lib/http';

const argsSchema = z.object({
  url: z
    .string()
    .min(1)
    .describe(
      'Full URL. https:// anywhere, or http:// only for localhost/127.0.0.1 (local MCP/API servers)',
    ),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET').describe('HTTP method'),
  headers: z
    .record(z.string())
    .optional()
    .describe('Extra request headers as a string map (optional)'),
  body: z
    .string()
    .optional()
    .describe(
      'Request body for POST/PUT/PATCH. JSON string unless a Content-Type header says otherwise (optional)',
    ),
  token: z.string().optional().describe('Bearer token added as Authorization header (optional)'),
  timeout_ms: z.number().max(60_000).default(15_000).describe('Request timeout'),
});
type Args = z.infer<typeof argsSchema>;

// `URL.hostname` garde les crochets d'une IPv6 : `[::1]`, pas `::1`.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

// Validate the URL: https anywhere; http only for local hosts (local MCP/API servers).
export function validateApiUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'URL invalide.' };
  }
  if (url.protocol === 'https:') return { ok: true, url };
  if (url.protocol === 'http:') {
    if (LOCAL_HOSTS.has(url.hostname)) return { ok: true, url };
    return {
      ok: false,
      error: 'http:// est réservé à localhost/127.0.0.1. Utilise https:// pour les URLs distantes.',
    };
  }
  return { ok: false, error: `Protocole non supporté: ${url.protocol}` };
}

export function buildHeaders(
  base: Record<string, string> | undefined,
  token: string | undefined,
  hasBody: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': API_USER_AGENT,
    Accept: 'application/json',
  };
  for (const [k, v] of Object.entries(base ?? {})) headers[k] = v;
  if (typeof token === 'string' && token.length > 0 && !('Authorization' in headers)) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (hasBody && !Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

export class CallApiTool extends BaseTool<Args> {
  readonly name = 'call_api';
  readonly description =
    'Appelle une API REST/JSON (GET/POST/PUT/PATCH/DELETE) — pour tes propres sites/services ou tout serveur MCP local. Ajoute un token Bearer optionnel. https partout ; http réservé à localhost. Parse le JSON de réponse si possible.';
  readonly category = 'web' as const;
  readonly riskLevel = 'high' as const;
  readonly requiresConfirmation = true;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(args: Args): Promise<ToolResult> {
    const { url: rawUrl, method, headers: extraHeaders, body, token, timeout_ms } = args;

    if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
      return this.fail('url est requis.');
    }

    const v = validateApiUrl(rawUrl.trim());
    if (!v.ok) return this.fail(v.error);

    const hasBody =
      typeof body === 'string' && body.length > 0 && method !== 'GET' && method !== 'DELETE';
    const headers = buildHeaders(extraHeaders, token, hasBody);
    const timeout = Math.min(Math.max(1000, timeout_ms), 60000);

    let res: HttpResponse;
    try {
      res = await httpRequest(v.url.toString(), {
        method,
        headers,
        ...(hasBody ? { body } : {}),
        timeoutMs: timeout,
      });
    } catch (err) {
      return this.fail(`Requête échouée: ${err instanceof Error ? err.message : String(err)}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    let json: unknown;
    let parseError = false;
    if (contentType.includes('json') || /^\s*[[{]/.test(res.text)) {
      try {
        json = JSON.parse(res.text);
      } catch {
        parseError = true;
      }
    }

    return this.ok({
      url: v.url.toString(),
      method,
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      contentType: contentType || null,
      ...(json !== undefined ? { json } : { body: res.text.slice(0, 20000) }),
      ...(parseError
        ? { note: 'Réponse annoncée JSON mais non parsable — body brut renvoyé.' }
        : {}),
      truncated: json === undefined && res.text.length > 20000,
    });
  }
}
