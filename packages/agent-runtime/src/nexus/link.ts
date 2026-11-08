// Liaison avec Nexus, l'application de bureau du Master (dépôt Master-App) installée sur ce poste.
//
// Quand son extension « CatDesk » est active, Nexus publie `%LOCALAPPDATA%\Nexus\link.json` :
// le port de son backend local et un jeton PROPRE à CatDesk, que Nexus n'accepte que sous
// `/link/v1/` (lire les cours, les devoirs, ajouter une note rapide, ouvrir un cours). Le
// jeton principal de Nexus, qui ouvre tout son API, ne sort jamais de Nexus.
//
// Le fichier est relu à CHAQUE appel : port et jeton changent à chaque lancement de Nexus, et
// il disparaît dès que l'extension est coupée.

import { homedir } from 'os';
import { join } from 'path';
import { z } from 'zod';
import { API_USER_AGENT, httpRequest } from '../lib/http';
import { readJsonFile } from '../lib/persistence';
import { createLogger } from '../logger';

const log = createLogger('nexus-link');

const linkSchema = z.object({
  version: z.literal(1),
  port: z.number().int().min(1).max(65_535),
  token: z.string().min(16),
  pid: z.number().int().positive(),
  workspace: z.string(),
  nexus: z.string(),
});
export type NexusLink = z.infer<typeof linkSchema>;

export type NexusResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const NEXUS_UNREACHABLE =
  "Nexus n'est pas lancé, ou sa liaison avec CatDesk est coupée (dans Nexus : Outils › Extensions › CatDesk).";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_BYTES = 2_000_000;

/** `CATDESK_NEXUS_LINK` (tests, développement), sinon `%LOCALAPPDATA%\Nexus\link.json`. */
export function linkFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['CATDESK_NEXUS_LINK'];
  if (override !== undefined && override.length > 0) return override;
  const local = env['LOCALAPPDATA'];
  const base =
    local !== undefined && local.length > 0 ? local : join(homedir(), 'AppData', 'Local');
  return join(base, 'Nexus', 'link.json');
}

/** Signal 0 : teste l'existence du processus sans le toucher (libuv le gère aussi sous Windows). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readLink(path: string = linkFilePath()): NexusResult<NexusLink> {
  const raw = readJsonFile(path, log);
  if (raw === undefined) return { ok: false, error: NEXUS_UNREACHABLE };
  const parsed = linkSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Fichier de liaison Nexus illisible : Nexus est peut-être plus récent que CatDesk.',
    };
  }
  // Nexus tué sans avoir pu retirer le fichier : son jeton ne vaut plus rien.
  if (!isAlive(parsed.data.pid)) return { ok: false, error: NEXUS_UNREACHABLE };
  return { ok: true, data: parsed.data };
}

export interface NexusRequest {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  timeoutMs?: number;
  /** Fichier de liaison à lire (tests) ; défaut : `linkFilePath()`. */
  linkPath?: string;
}

function detailOf(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail)) return 'Arguments refusés par Nexus';
  } catch {
    // pas du JSON : on s'en tient au statut
  }
  return undefined;
}

/** Appelle une route de `/link/v1` (ex. `search`) ; jamais d'exception, un résultat. */
export async function nexusRequest<T>(
  route: string,
  req: NexusRequest = {},
): Promise<NexusResult<T>> {
  const link = readLink(req.linkPath);
  if (!link.ok) return link;
  const url = new URL(`http://127.0.0.1:${link.data.port}/link/v1/${route}`);
  for (const [key, value] of Object.entries(req.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  let res;
  try {
    res = await httpRequest(url.toString(), {
      method: req.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${link.data.token}`,
        'Content-Type': 'application/json',
        'User-Agent': API_USER_AGENT,
      },
      ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBytes: MAX_BYTES,
    });
  } catch (err) {
    log.warn('Nexus injoignable', { route, error: String(err) });
    return { ok: false, error: NEXUS_UNREACHABLE };
  }
  if (res.status === 401) return { ok: false, error: NEXUS_UNREACHABLE };
  if (!res.ok) {
    return { ok: false, error: `Nexus : ${detailOf(res.text) ?? 'erreur'} (HTTP ${res.status})` };
  }
  try {
    return { ok: true, data: JSON.parse(res.text) as T };
  } catch {
    return { ok: false, error: `Réponse de Nexus illisible (HTTP ${res.status})` };
  }
}
