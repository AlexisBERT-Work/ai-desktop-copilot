/**
 * Chargement des serveurs MCP déclarés : lance chacun, liste ses outils, garde
 * ceux de la liste blanche, et les inscrit au registre ET au moteur de
 * permissions (risque `high` par défaut). Rien ne bloque le démarrage : appelé
 * sans `await` par `index.ts`, et un serveur en échec n'empêche pas les autres.
 */
import { mcpToolPermission, type ToolPermissionConfig } from '@catdesk/shared-types';
import { createLogger } from '../logger';
import { McpStdioClient, type McpCaller, type McpToolInfo } from './McpStdioClient';
import { CallBudget, McpTool, exposedToolName } from './McpTool';
import { readMcpConfig, type McpServerConfig } from './mcpConfig';

const log = createLogger('mcp:manager');

/** Un serveur vu par le gestionnaire : de quoi lister, appeler et arrêter. */
export interface McpServerHandle extends McpCaller {
  listTools(): Promise<McpToolInfo[]>;
  close(): void;
}

export interface McpManagerDeps {
  register: (tool: McpTool) => void;
  /** Inscrit la permission ; `false` si le moteur la refuse (l'outil n'est alors pas exposé). */
  permit: (entry: ToolPermissionConfig) => boolean;
  /** Remplaçable en test. */
  connect?: (server: McpServerConfig) => McpServerHandle;
}

export interface McpServerReport {
  id: string;
  tools: string[];
  error?: string;
}

export interface McpLoadReport {
  servers: McpServerReport[];
  errors: string[];
}

export class McpManager {
  private handles: McpServerHandle[] = [];
  private closed = false;

  constructor(private readonly deps: McpManagerDeps) {}

  async load(configPath?: string): Promise<McpLoadReport> {
    const config = await readMcpConfig(configPath);
    for (const error of config.errors) log.warn('MCP config entry refused', { error });
    const servers = await Promise.all(config.servers.map(server => this.loadServer(server)));
    return { servers, errors: config.errors };
  }

  close(): void {
    this.closed = true;
    for (const handle of this.handles) handle.close();
    this.handles = [];
  }

  private async loadServer(server: McpServerConfig): Promise<McpServerReport> {
    const connect = this.deps.connect ?? (s => new McpStdioClient(s));
    const handle = connect(server);
    this.handles.push(handle);
    let listed: McpToolInfo[];
    try {
      listed = await handle.listTools();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn('MCP server unavailable', { id: server.id, error });
      return { id: server.id, tools: [], error };
    }
    if (this.closed) return { id: server.id, tools: [] };

    const budget = new CallBudget(server.maxCallsPerMinute);
    const byName = new Map(listed.map(t => [t.name, t]));
    const exposed: string[] = [];
    for (const wanted of server.tools) {
      const info = byName.get(wanted);
      const name = exposedToolName(server.id, wanted);
      if (!info || name === undefined) {
        log.warn('MCP tool not exposed', {
          id: server.id,
          tool: wanted,
          reason: info ? 'nom trop long' : 'absent du serveur',
        });
        continue;
      }
      const tool = new McpTool(name, server, info, handle, budget);
      if (!this.deps.permit(mcpToolPermission(name, tool.description, server.risk))) continue;
      this.deps.register(tool);
      exposed.push(name);
    }
    const ignored = listed.length - exposed.length;
    log.info('MCP server loaded', { id: server.id, exposed, ignored });
    return { id: server.id, tools: exposed };
  }
}
