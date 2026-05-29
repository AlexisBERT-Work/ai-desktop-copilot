import type { PermissionRequest, PermissionResult, PermissionConfig, PermissionGrant } from '@neurodesk/shared-types';
import { DEFAULT_PERMISSION_CONFIG } from '@neurodesk/shared-types';
import { createLogger } from '../logger';

const log = createLogger('security:permissions');

export class PermissionEngine {
  private sessionGrants = new Map<string, PermissionGrant>();
  private config: PermissionConfig = DEFAULT_PERMISSION_CONFIG;

  // Called by IPC bridge when user responds to permission dialog in UI
  private pendingRequests = new Map<string, {
    resolve: (result: PermissionResult) => void;
    reject: (err: Error) => void;
  }>();

  updateConfig(config: Partial<PermissionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async check(request: PermissionRequest): Promise<PermissionResult> {
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
      return { granted: false, reason: 'Mode sécurisé actif — seules les opérations de lecture sont autorisées' };
    }

    // Critical tools require explicit enablement
    if (toolConfig.riskLevel === 'critical' && !this.config.enabledCritical.includes(request.tool)) {
      return { granted: false, reason: `Outil critique non activé dans les paramètres de sécurité` };
    }

    // Filesystem path validation
    if (request.tool.includes('file') || request.tool === 'list_directory') {
      const path = request.args['path'] as string | undefined;
      if (path && !this.isPathAllowed(path)) {
        return { granted: false, reason: `Chemin non autorisé: ${path}` };
      }
    }

    // LOW risk: auto-approve
    if (toolConfig.riskLevel === 'low') {
      return { granted: true, reason: 'Auto-approuvé (risque faible)' };
    }

    // MEDIUM risk: check session cache
    if (toolConfig.riskLevel === 'medium') {
      const cached = this.sessionGrants.get(request.tool);
      if (cached?.granted) {
        return { granted: true, reason: 'Autorisé (session)' };
      }
    }

    // HIGH / critical: always ask user
    if (!toolConfig.requiresConfirmation) {
      return { granted: true, reason: 'Autorisé (aucune confirmation requise)' };
    }

    // Request user confirmation via UI
    const result = await this.requestUserConfirmation(request, toolConfig.riskLevel);

    if (result.granted && toolConfig.riskLevel === 'medium' && result.remember) {
      this.sessionGrants.set(request.tool, { granted: true, timestamp: Date.now() });
    }

    return result;
  }

  /**
   * Called from IPC bridge when user responds to a permission dialog
   */
  resolvePermissionRequest(requestId: string, granted: boolean, remember?: boolean): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      pending.resolve({ granted, ...(remember !== undefined ? { remember } : {}) });
      this.pendingRequests.delete(requestId);
    }
  }

  private async requestUserConfirmation(
    request: PermissionRequest,
    riskLevel: string,
  ): Promise<PermissionResult> {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      this.pendingRequests.set(requestId, { resolve, reject });

      // Send permission request event to Tauri (via IPC bridge)
      // The bridge listens to this and forwards to React UI
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'permission.request',
          params: {
            requestId,
            tool: request.tool,
            args: request.args,
            riskLevel,
          },
        }) + '\n',
      );

      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Permission request timed out'));
        }
      }, 60_000);
    });
  }

  private isPathAllowed(path: string): boolean {
    if (this.config.pathWhitelist.length === 0) return true;

    const normalized = path.toLowerCase().replace(/\\/g, '/');

    // Expand Windows env vars for comparison
    const expandedWhitelist = this.config.pathWhitelist.map(p =>
      p.toLowerCase()
        .replace('%userprofile%', (process.env['USERPROFILE'] ?? 'C:/Users/user').replace(/\\/g, '/'))
        .replace('%temp%', (process.env['TEMP'] ?? 'C:/Temp').replace(/\\/g, '/')),
    );

    return expandedWhitelist.some(allowed => normalized.startsWith(allowed));
  }

  clearSessionGrants(): void {
    this.sessionGrants.clear();
  }
}
