/**
 * Un outil d'un serveur MCP déclaré, vu par l'agent comme n'importe quel outil :
 * il passe par le registre, donc par le moteur de permissions (risque `high` par
 * défaut, confirmation à chaque appel), l'audit (`AuditLogger`) et le nettoyage
 * des sorties (`sanitizeToolOutput`) de l'orchestrateur. Ce qui lui est propre :
 * - le plafond d'appels par minute, partagé par les outils d'un même serveur ;
 * - la durée maximale d'un appel ;
 * - la taille de la sortie : coupée, et la coupure est dite au modèle ;
 * - un échec du serveur devient un résultat d'outil, jamais un tour planté.
 */
import { z } from 'zod';
import type { JSONSchemaObject, McpRiskLevel, ToolResult } from '@catdesk/shared-types';
import { MCP_TOOL_PREFIX } from '@catdesk/shared-types';
import { BaseTool } from '../tools/base/BaseTool';
import type { McpCaller, McpCallResult, McpToolInfo } from './McpStdioClient';
import type { McpServerConfig } from './mcpConfig';
import { compactInputSchema, pathLikeArgs, toolDescription } from './mcpSchema';

/** Nom vu par le modèle : `mcp__<serveur>__<outil>`, caractères sûrs, 64 au plus. */
export function exposedToolName(serverId: string, toolName: string): string | undefined {
  const safe = toolName.replace(/[^A-Za-z0-9_-]/g, '_');
  const name = `${MCP_TOOL_PREFIX}${serverId}__${safe}`;
  return name.length <= 64 ? name : undefined;
}

/** Fenêtre glissante d'une minute, partagée par les outils d'un serveur. */
export class CallBudget {
  private stamps: number[] = [];

  constructor(private readonly perMinute: number) {}

  take(now = Date.now()): boolean {
    this.stamps = this.stamps.filter(t => now - t < 60_000);
    if (this.stamps.length >= this.perMinute) return false;
    this.stamps.push(now);
    return true;
  }
}

const MAX_CONTENT_ITEMS = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Le contenu d'un résultat MCP en texte : le texte tel quel, le reste résumé. */
export function renderMcpContent(result: McpCallResult): string {
  const parts: string[] = [];
  for (const item of result.content.slice(0, MAX_CONTENT_ITEMS)) {
    if (!isRecord(item)) continue;
    switch (item['type']) {
      case 'text':
        if (typeof item['text'] === 'string') parts.push(item['text']);
        break;
      case 'image':
        parts.push('[image omise]');
        break;
      case 'audio':
        parts.push('[audio omis]');
        break;
      case 'resource_link':
        parts.push(`[ressource : ${String(item['name'] ?? item['uri'] ?? '?')}]`);
        break;
      case 'resource': {
        const resource = isRecord(item['resource']) ? item['resource'] : {};
        parts.push(
          typeof resource['text'] === 'string'
            ? resource['text']
            : `[ressource : ${String(resource['uri'] ?? '?')}]`,
        );
        break;
      }
      default:
        break;
    }
  }
  if (parts.length === 0 && result.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent);
  }
  return parts.join('\n');
}

/** Coupe à `max` caractères en le disant : le modèle ne doit pas croire avoir tout lu. */
export function clipOutput(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[sortie coupée : ${max} caractères gardés sur ${text.length}]`;
}

export class McpTool extends BaseTool<Record<string, unknown>> {
  readonly name: string;
  readonly description: string;
  readonly category = 'automation' as const;
  readonly riskLevel: McpRiskLevel;
  readonly requiresConfirmation = true;
  override readonly argsSchema = z.record(z.string(), z.unknown());
  readonly schema: JSONSchemaObject;
  override readonly pathArgs: readonly string[];
  /** Lus par `selectTools` seulement (comme `toolKeywords.ts`), jamais envoyés au modèle. */
  readonly keywords: readonly string[];

  constructor(
    name: string,
    private readonly server: McpServerConfig,
    private readonly info: McpToolInfo,
    private readonly caller: McpCaller,
    private readonly budget: CallBudget,
  ) {
    super();
    this.name = name;
    this.riskLevel = server.risk;
    this.description = toolDescription(
      server.id,
      info.name,
      info.description,
      server.descriptions[info.name],
    );
    this.schema = compactInputSchema(info.inputSchema);
    this.pathArgs = pathLikeArgs(this.schema);
    this.keywords = [...server.keywords, 'mcp'];
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { id, maxCallsPerMinute, timeoutMs, maxOutputChars } = this.server;
    if (!this.budget.take()) {
      return this.fail(
        `Plafond atteint : ${maxCallsPerMinute} appels par minute au serveur MCP « ${id} ». Réessaie plus tard.`,
      );
    }
    let result: McpCallResult;
    try {
      result = await this.caller.callTool(this.info.name, args, timeoutMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.fail(`Serveur MCP « ${id} » : ${message}`, { server: id });
    }
    const text = clipOutput(renderMcpContent(result), maxOutputChars);
    if (result.isError) {
      return this.fail(`L'outil MCP a renvoyé une erreur : ${text}`, { server: id });
    }
    return this.ok(text.length > 0 ? text : '(aucun contenu)', { server: id });
  }
}
