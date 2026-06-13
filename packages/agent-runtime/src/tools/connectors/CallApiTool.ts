import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface CallApiArgs {
  url: string;
  method?: Method;
  headers?: Record<string, string>;
  body?: string;
  token?: string;
  timeout_ms?: number;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

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
    return { ok: false, error: 'http:// est réservé à localhost/127.0.0.1. Utilise https:// pour les URLs distantes.' };
  }
  return { ok: false, error: `Protocole non supporté: ${url.protocol}` };
}

export function buildHeaders(
  base: Record<string, string> | undefined,
  token: string | undefined,
  hasBody: boolean,
): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': 'catdesk-agent/1.0', 'Accept': 'application/json' };
  for (const [k, v] of Object.entries(base ?? {})) headers[k] = v;
  if (typeof token === 'string' && token.length > 0 && !('Authorization' in headers)) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (hasBody && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

async function request(
  url: URL,
  method: Method,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  const isHttps = url.protocol === 'https:';
  const { default: client } = await import(isHttps ? 'https' : 'http');
  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        headers,
      },
      (res: import('http').IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf-8') }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Délai dépassé')); });
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export class CallApiTool extends BaseTool {
  readonly name = 'call_api';
  readonly description =
    "Appelle une API REST/JSON (GET/POST/PUT/PATCH/DELETE) — pour tes propres sites/services ou tout serveur MCP local. Ajoute un token Bearer optionnel. https partout ; http réservé à localhost. Parse le JSON de réponse si possible.";
  readonly category = 'web' as const;
  readonly riskLevel = 'high' as const;
  readonly requiresConfirmation = true;
  readonly schema = TOOL_SCHEMAS.call_api;

  async execute(args: unknown): Promise<ToolResult> {
    const { url: rawUrl, method = 'GET', headers: extraHeaders, body, token, timeout_ms = 15000 } =
      args as CallApiArgs;

    if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
      return this.fail('url est requis.');
    }

    const v = validateApiUrl(rawUrl.trim());
    if (!v.ok) return this.fail(v.error);

    const hasBody = typeof body === 'string' && body.length > 0 && method !== 'GET' && method !== 'DELETE';
    const headers = buildHeaders(extraHeaders, token, hasBody);
    const timeout = Math.min(Math.max(1000, timeout_ms), 60000);

    let res: { status: number; headers: Record<string, string | string[] | undefined>; text: string };
    try {
      res = await request(v.url, method, headers, hasBody ? body : undefined, timeout);
    } catch (err) {
      return this.fail(`Requête échouée: ${err instanceof Error ? err.message : String(err)}`);
    }

    const contentType = String(res.headers['content-type'] ?? '');
    let json: unknown;
    let parseError = false;
    if (contentType.includes('json') || /^\s*[[{]/.test(res.text)) {
      try { json = JSON.parse(res.text); } catch { parseError = true; }
    }

    return this.ok({
      url: v.url.toString(),
      method,
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      contentType: contentType || null,
      ...(json !== undefined ? { json } : { body: res.text.slice(0, 20000) }),
      ...(parseError ? { note: 'Réponse annoncée JSON mais non parsable — body brut renvoyé.' } : {}),
      truncated: json === undefined && res.text.length > 20000,
    });
  }
}
