import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { PermissionRequestEvent } from '@catdesk/shared-types';
import { PermissionPrompt } from './PermissionPrompt';

const bus = vi.hoisted(() => ({
  handler: undefined as undefined | ((e: { payload: unknown }) => void),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (_event: string, cb: (e: { payload: unknown }) => void) => {
    bus.handler = cb;
    return Promise.resolve(() => {});
  },
}));
vi.mock('../../shared/api/permissions', () => ({ respondToPermission: vi.fn() }));

const request = (over: Partial<PermissionRequestEvent> = {}): PermissionRequestEvent => ({
  requestId: 'r1',
  tool: 'send_webhook_message',
  description: 'Envoie un message vers un webhook',
  riskLevel: 'high',
  args: { message: 'IBAN [IBAN masqué]' },
  ...over,
});

describe('PermissionPrompt — données personnelles', () => {
  it('affiche ce que le masquage a fait, au-dessus des paramètres masqués', () => {
    render(<PermissionPrompt />);
    act(() => bus.handler?.({ payload: request({ preview: 'Masqué avant envoi : 1 IBAN.' }) }));
    expect(screen.getByText('Masqué avant envoi : 1 IBAN.')).toBeInTheDocument();
    expect(screen.getByText(/\[IBAN masqué\]/)).toBeInTheDocument();
  });

  it('sans masquage, pas de bandeau', () => {
    render(<PermissionPrompt />);
    act(() => bus.handler?.({ payload: request({ args: { message: 'salut' } }) }));
    expect(screen.queryByText(/Masqué avant envoi/)).not.toBeInTheDocument();
  });
});
