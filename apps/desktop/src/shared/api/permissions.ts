import { invoke } from '@tauri-apps/api/core';
import type { GrantScope } from '@catdesk/shared-types';

/**
 * Transmet la décision de l'utilisateur sur une demande de permission d'outil,
 * avec sa portée : cette fois, ce site ou la session (le cœur Rust refuse une
 * portée inconnue, l'agent ramène à « une fois » une portée qu'il n'a pas proposée).
 */
export function respondToPermission(
  requestId: string,
  granted: boolean,
  scope: GrantScope = 'once',
): Promise<void> {
  return invoke('permission_respond', { args: { requestId, granted, scope } });
}
