/**
 * Déclaration des serveurs MCP par l'utilisateur : `mcp-servers.json` dans le
 * dossier de données (ou le chemin de `CATDESK_MCP_CONFIG`). Sans ce fichier,
 * aucun serveur n'est lancé et aucun outil n'est ajouté.
 *
 * Ce que la déclaration impose, et pourquoi :
 * - **stdio local seulement** : un serveur est une commande lancée sur le poste.
 *   Aucune entrée `url` n'est acceptée (pas de serveur distant, ni par défaut ni
 *   autrement, tant qu'un choix explicite n'a pas été fait — voir CAPACITES.md) ;
 * - **liste blanche d'outils** (`tools`) obligatoire, sans joker : un outil que
 *   le serveur ajoute plus tard n'apparaît pas tout seul ;
 * - **plafonds** de durée, de taille de sortie et d'appels par minute : une
 *   valeur hors bornes fait refuser le serveur, elle n'est pas appliquée ;
 * - **risque** `high` par défaut, `medium` au mieux : jamais auto-approuvé.
 */
import { readFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { CONFIG } from '../config';
import { formatZodError } from '../tools/base/BaseTool';

export const MCP_CONFIG_FILE = 'mcp-servers.json';

/** Outils exposés par serveur, au plus : chaque outil proposé coûte ~2 s de prompt. */
export const MAX_TOOLS_PER_SERVER = 8;

/** Identifiant de serveur : court, il entre dans le nom `mcp__<id>__<outil>` (64 car. max). */
const SERVER_ID = /^[a-z0-9][a-z0-9_-]{0,23}$/;

/**
 * `.cmd`/`.bat`/`.ps1` ne se lancent pas sans shell, et un shell réinterpréterait
 * les arguments : on demande l'exécutable (node, python, uvx…) et son script.
 */
const SHELL_SCRIPT = /\.(cmd|bat|ps1)$/i;

const serverSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).max(32).default([]),
    cwd: z.string().optional(),
    /** Variables ajoutées à l'environnement minimal (jamais les secrets du .env de CatDesk). */
    env: z.record(z.string(), z.string()).default({}),
    /** Liste blanche des outils du serveur exposés à l'agent (noms exacts). */
    tools: z.array(z.string().min(1)).min(1).max(MAX_TOOLS_PER_SERVER),
    /** Description en français par outil, à la place de celle du serveur. */
    descriptions: z.record(z.string(), z.string().max(300)).default({}),
    /** Mots qui font proposer ces outils (comme `toolKeywords.ts`). */
    keywords: z.array(z.string().min(3)).max(20).default([]),
    risk: z.enum(['medium', 'high']).default('high'),
    timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
    maxOutputChars: z.number().int().min(200).max(20_000).default(4_000),
    maxCallsPerMinute: z.number().int().min(1).max(60).default(10),
    enabled: z.boolean().default(true),
  })
  .strict();

export type McpServerConfig = z.infer<typeof serverSchema> & { id: string };

export interface McpConfigResult {
  servers: McpServerConfig[];
  /** Entrées refusées, en français : affichées dans le journal, jamais fatales. */
  errors: string[];
}

/** Chemin de la déclaration (lu à chaque appel : les tests le changent). */
export function mcpConfigPath(): string {
  const override = process.env['CATDESK_MCP_CONFIG']?.trim();
  if (override) return override;
  return join(process.env['CATDESK_DATA_DIR'] ?? CONFIG.dataDir, MCP_CONFIG_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Valide une déclaration déjà lue (séparé de la lecture pour les tests). */
export function parseMcpConfig(raw: unknown): McpConfigResult {
  const servers: McpServerConfig[] = [];
  const errors: string[] = [];
  const declared = isRecord(raw) ? raw['servers'] : undefined;
  if (!isRecord(declared)) {
    return { servers, errors: ['mcp-servers.json : objet « servers » attendu'] };
  }

  for (const [id, entry] of Object.entries(declared)) {
    if (!SERVER_ID.test(id)) {
      errors.push(`serveur « ${id} » : identifiant en minuscules, chiffres, - ou _ (24 car. max)`);
      continue;
    }
    if (isRecord(entry) && ('url' in entry || 'transport' in entry)) {
      errors.push(`serveur « ${id} » : serveur distant refusé, seule une commande locale (stdio)`);
      continue;
    }
    const parsed = serverSchema.safeParse(entry);
    if (!parsed.success) {
      errors.push(`serveur « ${id} » : ${formatZodError(parsed.error)}`);
      continue;
    }
    const command = parsed.data.command.trim();
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(command)) {
      errors.push(`serveur « ${id} » : serveur distant refusé, seule une commande locale (stdio)`);
      continue;
    }
    if (SHELL_SCRIPT.test(command)) {
      errors.push(
        `serveur « ${id} » : « ${command} » est un script, indiquer l'exécutable (node, python, uvx…) et le script dans args`,
      );
      continue;
    }
    if (!parsed.data.enabled) continue;
    servers.push({ ...parsed.data, command, id });
  }
  return { servers, errors };
}

/** Lit la déclaration. Fichier absent : aucun serveur, sans erreur. */
export async function readMcpConfig(path = mcpConfigPath()): Promise<McpConfigResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { servers: [], errors: [] };
    return { servers: [], errors: [`${path} illisible : ${String(err)}`] };
  }
  try {
    return parseMcpConfig(JSON.parse(text.replace(/^\uFEFF/, '')) as unknown);
  } catch (err) {
    return { servers: [], errors: [`${path} : JSON invalide (${String(err)})`] };
  }
}
