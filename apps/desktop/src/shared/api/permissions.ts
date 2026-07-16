import { invoke } from '@tauri-apps/api/core';

/** Transmet la décision de l'utilisateur sur une demande de permission d'outil. */
export function respondToPermission(
  requestId: string,
  granted: boolean,
  remember: boolean,
): Promise<void> {
  return invoke('permission_respond', { args: { requestId, granted, remember } });
}
