import type { PermissionRequest, PermissionResult, PermissionConfig, PermissionGrant } from '@catdesk/shared-types';
import { DEFAULT_PERMISSION_CONFIG } from '@catdesk/shared-types';
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

    // Filesystem path validation — applies to ANY tool carrying a filesystem
    // path argument, not just those whose name contains "file". Otherwise
    // path-taking tools like parse_document, analyze_data, read_calendar,
    // transcribe_audio or run_sqlite (db_path) read arbitrary files outside the
    // whitelist (e.g. the Chrome cookies SQLite DB), defeating the whole point
    // of the whitelist. `workdir` is intentionally excluded: it is a working
    // directory for command tools (git/docker), not a read/write target.
    for (const key of ['path', 'db_path'] as const) {
      const candidate = request.args[key];
      if (typeof candidate === 'string' && candidate.length > 0 && !this.isPathAllowed(candidate)) {
        return { granted: false, reason: `Chemin non autorisé: ${candidate}` };
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
