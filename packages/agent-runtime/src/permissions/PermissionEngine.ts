import type {
  PermissionRequest,
  PermissionResult,
  PermissionConfig,
  PermissionGrant,
  RiskLevel,
  ToolPermissionConfig,
} from '@catdesk/shared-types';
import {
  DEFAULT_PERMISSION_CONFIG,
  MCP_TOOL_PREFIX,
  PERMISSION_TIMEOUT_MS,
  RPC_NOTIFICATIONS,
} from '@catdesk/shared-types';
import { stdoutNotifier, type NotifyFn } from '../ipc/Notifier';
import { createLogger } from '../logger';
import { createPathGuard } from './realPath';

const log = createLogger('security:permissions');

export class PermissionEngine {
  private sessionGrants = new Map<string, PermissionGrant>();
  private config: PermissionConfig = DEFAULT_PERMISSION_CONFIG;
  /**
   * Outils chargés à l'exécution (MCP). À part de `config.tools` : une mise à
   * jour de la config par l'UI (`updateConfig`) ne doit pas les effacer.
   */
  private dynamicTools = new Map<string, ToolPermissionConfig>();

  /** Demandes de confirmation en attente d'une réponse de l'UI, par requestId. */
  private pendingRequests = new Map<string, (result: PermissionResult) => void>();

  /**
   * @param browserReadOnly lit la lecture seule du navigateur (BrowserManager,
   *   seule source de vérité). Par défaut : jamais — le risque déclaré s'applique.
   */
  constructor(
    private readonly notify: NotifyFn = stdoutNotifier,
    private readonly timeoutMs: number = PERMISSION_TIMEOUT_MS,
    private readonly browserReadOnly: () => boolean = () => false,
  ) {}

  /** Risque appliqué maintenant : abaissé si l'outil le prévoit et que le navigateur est en lecture seule. */
  effectiveRisk(toolConfig: ToolPermissionConfig): RiskLevel {
    const lowered = toolConfig.riskLevelWhenReadOnly;
    return lowered !== undefined && this.browserReadOnly() ? lowered : toolConfig.riskLevel;
  }

  updateConfig(config: Partial<PermissionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Inscrit la permission d'un outil chargé à l'exécution. Seuls les outils MCP
   * (`mcp__…`) sont acceptés, jamais en risque `low` et toujours avec
   * confirmation : un serveur déclaré ne peut ni se faire auto-approuver, ni
   * prendre le nom d'un outil intégré.
   */
  registerDynamicTool(entry: ToolPermissionConfig): boolean {
    const refused =
      !entry.name.startsWith(MCP_TOOL_PREFIX) ||
      entry.riskLevel === 'low' ||
      entry.name in this.config.tools;
    if (refused) {
      log.warn('Dynamic tool permission refused', { tool: entry.name, risk: entry.riskLevel });
      return false;
    }
    this.dynamicTools.set(entry.name, { ...entry, requiresConfirmation: true });
    return true;
  }

  /**
   * Décide si un outil peut s'exécuter. Ne lève jamais : un délai de réponse
   * dépassé ou un run interrompu (`signal`) valent refus — avant, le délai
   * REJETAIT, et l'exception remontait jusqu'à faire échouer le run entier.
   */
  async check(request: PermissionRequest, signal?: AbortSignal): Promise<PermissionResult> {
    const toolConfig = this.config.tools[request.tool] ?? this.dynamicTools.get(request.tool);

    if (!toolConfig) {
      log.warn('Unknown tool permission check', { tool: request.tool });
      return { granted: false, reason: `Tool inconnu: ${request.tool}` };
    }

    if (!toolConfig.enabled) {
      return { granted: false, reason: `Tool désactivé: ${request.tool}` };
    }

    const risk = this.effectiveRisk(toolConfig);

    // Safe mode: block everything above low
    if (this.config.safeMode && risk !== 'low') {
      log.info('Blocked by safe mode', { tool: request.tool, risk });
      return {
        granted: false,
        reason: 'Mode sécurisé actif — seules les opérations de lecture sont autorisées',
      };
    }

    // Critical tools require explicit enablement
    if (risk === 'critical' && !this.config.enabledCritical.includes(request.tool)) {
      return {
        granted: false,
        reason: `Outil critique non activé dans les paramètres de sécurité`,
      };
    }

    // Liste blanche des chemins : appliquée aux chemins que l'outil DÉCLARE
    // (BaseTool.pathArgs → request.paths), quel que soit son niveau de risque
    // — sinon un outil `low` lirait n'importe quel fichier (ex. la base de
    // cookies de Chrome), ce qui ruinerait la liste blanche. Chaque chemin est
    // vérifié tel qu'écrit PUIS résolu (`realPath.ts`) : une jonction posée
    // dans Documents ne mène plus hors de la liste.
    const pathGuard = createPathGuard(this.config.pathWhitelist);
    for (const candidate of request.paths ?? []) {
      const verdict = await pathGuard(candidate);
      if (!verdict.allowed) {
        return { granted: false, reason: verdict.reason };
      }
    }

    // LOW risk: auto-approve
    if (risk === 'low') {
      return { granted: true, reason: 'Auto-approuvé (risque faible)' };
    }

    // MEDIUM risk: check session cache. Une autorisation donnée en lecture
    // seule ne vaut que tant que le risque est `medium` : lecture seule coupée,
    // `browser_navigate` redevient `high` et redemande à chaque fois.
    if (risk === 'medium' && this.sessionGrants.get(request.tool)?.granted) {
      return { granted: true, reason: 'Autorisé (session)' };
    }

    if (!toolConfig.requiresConfirmation) {
      return { granted: true, reason: 'Autorisé (aucune confirmation requise)' };
    }

    // Request user confirmation via UI
    const result = await this.requestUserConfirmation(
      request,
      risk,
      toolConfig.description,
      signal,
    );

    if (result.granted && risk === 'medium' && result.remember) {
      this.sessionGrants.set(request.tool, { granted: true, timestamp: Date.now() });
    }

    return result;
  }

  /** Réponse de l'utilisateur au dialogue de permission (relayée par le bridge). */
  resolvePermissionRequest(requestId: string, granted: boolean, remember?: boolean): void {
    this.pendingRequests.get(requestId)?.({
      granted,
      ...(remember !== undefined ? { remember } : {}),
    });
  }

  private requestUserConfirmation(
    request: PermissionRequest,
    riskLevel: RiskLevel,
    description: string,
    signal: AbortSignal | undefined,
  ): Promise<PermissionResult> {
    if (signal?.aborted) return Promise.resolve({ granted: false, reason: 'Run interrompu' });

    return new Promise(resolve => {
      const requestId = crypto.randomUUID();
      // Réponse de l'UI, délai dépassé ou run interrompu : le premier arrivé
      // règle la demande, les suivants ne font rien.
      const settle = (result: PermissionResult): void => {
        if (!this.pendingRequests.delete(requestId)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = (): void => settle({ granted: false, reason: 'Run interrompu' });
      const timer = setTimeout(
        () => settle({ granted: false, reason: 'Pas de réponse au dialogue de permission' }),
        this.timeoutMs,
      );
      this.pendingRequests.set(requestId, settle);
      signal?.addEventListener('abort', onAbort, { once: true });

      // Le bridge Rust relaie la notification à l'UI (dialogue de permission).
      this.notify(RPC_NOTIFICATIONS.permissionRequest, {
        requestId,
        tool: request.tool,
        description,
        args: request.args,
        riskLevel,
        ...(request.preview !== undefined ? { preview: request.preview } : {}),
      });
    });
  }

  clearSessionGrants(): void {
    this.sessionGrants.clear();
  }
}
