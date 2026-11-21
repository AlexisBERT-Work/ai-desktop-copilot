import type {
  GrantScope,
  PermissionRequest,
  PermissionResult,
  PermissionConfig,
  PermissionGrant,
  RiskLevel,
  ToolPermissionConfig,
} from '@catdesk/shared-types';
import {
  DEFAULT_PERMISSION_CONFIG,
  PERMISSION_TIMEOUT_MS,
  RPC_NOTIFICATIONS,
} from '@catdesk/shared-types';
import { stdoutNotifier, type NotifyFn } from '../ipc/Notifier';
import { registrableDomain } from '../lib/registrableDomain';
import { createLogger } from '../logger';
import { createPathGuard } from './realPath';

const log = createLogger('security:permissions');

/** Réponse brute de l'UI, avant de la confronter aux portées proposées. */
interface UserAnswer {
  granted: boolean;
  scope?: GrantScope;
}

/**
 * Clé d'un accord de session : l'outil seul (portée `session`), ou l'outil et
 * le site (portée `site`). Un `@` ne peut figurer ni dans un nom d'outil ni
 * dans un nom d'hôte : les deux familles de clés ne se recouvrent pas.
 */
export function grantKey(tool: string, site?: string): string {
  return site === undefined ? tool : `${tool}@${site}`;
}

export class PermissionEngine {
  /** Accords valables jusqu'à la fin de la session, par `grantKey`. */
  private sessionGrants = new Map<string, PermissionGrant>();
  private config: PermissionConfig = DEFAULT_PERMISSION_CONFIG;

  /** Demandes de confirmation en attente d'une réponse de l'UI, par requestId. */
  private pendingRequests = new Map<string, (answer: UserAnswer) => void>();

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

  /**
   * Site de l'accord « pour ce site », s'il s'applique maintenant : l'outil le
   * prévoit, le navigateur est en lecture seule et la page visée a un site.
   * Lecture seule coupée : `undefined`, les accords par site déjà donnés
   * dorment (ils reviennent avec la lecture seule).
   */
  siteFor(request: PermissionRequest, toolConfig: ToolPermissionConfig): string | undefined {
    if (toolConfig.siteGrantWhenReadOnly !== true || !this.browserReadOnly()) return undefined;
    return request.url === undefined ? undefined : registrableDomain(request.url);
  }

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

    // Accord « pour ce site » déjà donné : vaut pour cet outil sur ce site,
    // quel que soit son risque, mais seulement en lecture seule (`siteFor`).
    const site = this.siteFor(request, toolConfig);
    if (site !== undefined && this.sessionGrants.get(grantKey(request.tool, site))?.granted) {
      return { granted: true, reason: `Autorisé pour ${site} (session)`, scope: 'site', site };
    }

    // MEDIUM risk: check session cache. Une autorisation donnée en lecture
    // seule ne vaut que tant que le risque est `medium` : lecture seule coupée,
    // `browser_navigate` redevient `high` et redemande à chaque fois.
    if (risk === 'medium' && this.sessionGrants.get(grantKey(request.tool))?.granted) {
      return { granted: true, reason: 'Autorisé (session)', scope: 'session' };
    }

    if (!toolConfig.requiresConfirmation) {
      return { granted: true, reason: 'Autorisé (aucune confirmation requise)' };
    }

    // Portées proposées : le site s'il s'applique, la session pour `medium`
    // seulement — `high` redemande à chaque fois partout ailleurs.
    const scopes: GrantScope[] = ['once'];
    if (site !== undefined) scopes.push('site');
    if (risk === 'medium') scopes.push('session');

    const result = await this.requestUserConfirmation(request, {
      riskLevel: risk,
      description: toolConfig.description,
      scopes,
      site,
      signal,
    });

    if (result.granted && result.scope === 'site' && site !== undefined) {
      this.sessionGrants.set(grantKey(request.tool, site), {
        granted: true,
        timestamp: Date.now(),
      });
    } else if (result.granted && result.scope === 'session') {
      this.sessionGrants.set(grantKey(request.tool), { granted: true, timestamp: Date.now() });
    }

    return result;
  }

  /**
   * Réponse de l'utilisateur au dialogue de permission (relayée par le
   * bridge). Une portée que la demande ne proposait pas vaut `once`.
   */
  resolvePermissionRequest(requestId: string, granted: boolean, scope?: GrantScope): void {
    this.pendingRequests.get(requestId)?.({ granted, ...(scope !== undefined ? { scope } : {}) });
  }

  private requestUserConfirmation(
    request: PermissionRequest,
    offer: {
      riskLevel: RiskLevel;
      description: string;
      scopes: GrantScope[];
      site: string | undefined;
      signal: AbortSignal | undefined;
    },
  ): Promise<PermissionResult> {
    const { signal, site, scopes } = offer;
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
      this.pendingRequests.set(requestId, answer => {
        if (!answer.granted) {
          settle({ granted: false, reason: "Refusé par l'utilisateur", requestId });
          return;
        }
        const scope =
          answer.scope !== undefined && scopes.includes(answer.scope) ? answer.scope : 'once';
        settle({
          granted: true,
          reason: "Autorisé par l'utilisateur",
          scope,
          requestId,
          ...(site !== undefined ? { site } : {}),
        });
      });
      signal?.addEventListener('abort', onAbort, { once: true });

      // Le bridge Rust relaie la notification à l'UI (dialogue de permission).
      this.notify(RPC_NOTIFICATIONS.permissionRequest, {
        requestId,
        tool: request.tool,
        description: offer.description,
        args: request.args,
        riskLevel: offer.riskLevel,
        scopes,
        ...(site !== undefined ? { site } : {}),
        ...(request.preview !== undefined ? { preview: request.preview } : {}),
      });
    });
  }

  clearSessionGrants(): void {
    this.sessionGrants.clear();
  }
}
