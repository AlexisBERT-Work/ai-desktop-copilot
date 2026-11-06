import type {
  PermissionRequest,
  PermissionResult,
  PermissionConfig,
  PermissionGrant,
  RiskLevel,
} from '@catdesk/shared-types';
import {
  DEFAULT_PERMISSION_CONFIG,
  PERMISSION_TIMEOUT_MS,
  RPC_NOTIFICATIONS,
} from '@catdesk/shared-types';
import { stdoutNotifier, type NotifyFn } from '../ipc/Notifier';
import { createLogger } from '../logger';

const log = createLogger('security:permissions');

export class PermissionEngine {
  private sessionGrants = new Map<string, PermissionGrant>();
  private config: PermissionConfig = DEFAULT_PERMISSION_CONFIG;

  /** Demandes de confirmation en attente d'une réponse de l'UI, par requestId. */
  private pendingRequests = new Map<string, (result: PermissionResult) => void>();

  constructor(
    private readonly notify: NotifyFn = stdoutNotifier,
    private readonly timeoutMs: number = PERMISSION_TIMEOUT_MS,
  ) {}

  updateConfig(config: Partial<PermissionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Décide si un outil peut s'exécuter. Ne lève jamais : un délai de réponse
   * dépassé ou un run interrompu (`signal`) valent refus — avant, le délai
   * REJETAIT, et l'exception remontait jusqu'à faire échouer le run entier.
   */
  async check(request: PermissionRequest, signal?: AbortSignal): Promise<PermissionResult> {
    const toolConfig = this.config.tools[request.tool];

    if (!toolConfig) {
      log.warn('Unknown tool permission check', { tool: request.tool });
      return { granted: false, reason: `Tool inconnu: ${request.tool}` };
    }

    if (!toolConfig.enabled) {
      return { granted: false, reason: `Tool désactivé: ${request.tool}` };
    }

    // Safe mode: block everything above low
    if (this.config.safeMode && toolConfig.riskLevel !== 'low') {
      log.info('Blocked by safe mode', { tool: request.tool, risk: toolConfig.riskLevel });
      return {
        granted: false,
        reason: 'Mode sécurisé actif — seules les opérations de lecture sont autorisées',
      };
    }

    // Critical tools require explicit enablement
    if (
      toolConfig.riskLevel === 'critical' &&
      !this.config.enabledCritical.includes(request.tool)
    ) {
      return {
        granted: false,
        reason: `Outil critique non activé dans les paramètres de sécurité`,
      };
    }

    // Liste blanche des chemins : appliquée aux chemins que l'outil DÉCLARE
    // (BaseTool.pathArgs → request.paths), quel que soit son niveau de risque
    // — sinon un outil `low` lirait n'importe quel fichier (ex. la base de
    // cookies de Chrome), ce qui ruinerait la liste blanche.
    for (const candidate of request.paths ?? []) {
      if (!this.isPathAllowed(candidate)) {
        return { granted: false, reason: `Chemin non autorisé: ${candidate}` };
      }
    }

    // LOW risk: auto-approve
    if (toolConfig.riskLevel === 'low') {
      return { granted: true, reason: 'Auto-approuvé (risque faible)' };
    }

    // MEDIUM risk: check session cache
    if (toolConfig.riskLevel === 'medium' && this.sessionGrants.get(request.tool)?.granted) {
      return { granted: true, reason: 'Autorisé (session)' };
    }

    if (!toolConfig.requiresConfirmation) {
      return { granted: true, reason: 'Autorisé (aucune confirmation requise)' };
    }

    // Request user confirmation via UI
    const result = await this.requestUserConfirmation(
      request,
      toolConfig.riskLevel,
      toolConfig.description,
      signal,
    );

    if (result.granted && toolConfig.riskLevel === 'medium' && result.remember) {
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
      });
    });
  }

  private isPathAllowed(path: string): boolean {
    if (this.config.pathWhitelist.length === 0) return true;

    // Normalize the same way on both sides: lowercase + forward slashes. This
    // MUST be applied AFTER env-var expansion so the expanded values (which keep
    // their original casing and backslashes) are normalized too — otherwise a
    // whitelist entry like "%USERPROFILE%\Documents" expands to
    // "C:/Users/Name\Documents" and never matches a lowercased "/documents/…".
    const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();

    const userProfile = process.env['USERPROFILE'] ?? 'C:/Users/user';
    const temp = process.env['TEMP'] ?? process.env['TMP'] ?? 'C:/Temp';

    const normalized = norm(path);

    // Reject path traversal outright: no legitimate whitelisted path needs a
    // `..` segment. Without this, `…/Downloads/../.ssh/id_rsa` slips through the
    // startsWith() check below (it starts with the whitelisted `…/Downloads`)
    // and Node's fs then resolves the `..` to read outside the allowed roots.
    if (normalized.split('/').some(seg => seg === '..')) return false;

    const expandedWhitelist = this.config.pathWhitelist.map(p =>
      norm(p.replace(/%userprofile%/gi, userProfile).replace(/%temp%/gi, temp)),
    );

    // Require a directory-boundary match so an allowed root like `…/documents`
    // does not also authorize a sibling `…/documents-evil`. Accept an exact
    // match or the root followed by a separator.
    return expandedWhitelist.some(allowed => {
      if (allowed.length === 0) return false;
      if (normalized === allowed) return true;
      const withSep = allowed.endsWith('/') ? allowed : `${allowed}/`;
      return normalized.startsWith(withSep);
    });
  }

  clearSessionGrants(): void {
    this.sessionGrants.clear();
  }
}
