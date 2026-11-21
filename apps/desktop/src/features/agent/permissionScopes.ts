import type { GrantScope, PermissionRequestEvent } from '@catdesk/shared-types';

/**
 * Portées que la carte de confirmation propose. L'agent les envoie ; un agent
 * plus ancien ne les envoie pas, et l'ancienne règle s'applique (session pour
 * un risque moyen).
 */
export function offeredScopes(request: PermissionRequestEvent): GrantScope[] {
  if (request.scopes !== undefined) return request.scopes;
  return request.riskLevel === 'medium' ? ['once', 'session'] : ['once'];
}
