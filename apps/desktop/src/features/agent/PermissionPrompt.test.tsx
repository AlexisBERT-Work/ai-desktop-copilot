import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PermissionRequestEvent } from '@catdesk/shared-types';
import { PermissionPrompt } from './PermissionPrompt';
import { offeredScopes } from './permissionScopes';

// L'événement Tauri est capté ici pour être émis à la main ; la réponse part
// par l'API partagée (React → invoke → Rust), jamais vers l'agent en direct.
const bus = vi.hoisted(() => ({
  handler: undefined as undefined | ((e: { payload: unknown }) => void),
  respond: vi.fn(async (_requestId: string, _granted: boolean, _scope?: string) => {}),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (_event: string, cb: (e: { payload: unknown }) => void) => {
    bus.handler = cb;
    return Promise.resolve(() => {});
  },
}));
vi.mock('../../shared/api/permissions', () => ({ respondToPermission: bus.respond }));

const request = (over: Partial<PermissionRequestEvent> = {}): PermissionRequestEvent => ({
  requestId: 'r1',
  tool: 'send_webhook_message',
  description: 'Envoie un message vers un webhook',
  riskLevel: 'high',
  args: { message: 'IBAN [IBAN masqué]' },
  ...over,
});

const clickRequest: PermissionRequestEvent = {
  requestId: 'req-1',
  tool: 'browser_click',
  description: 'Cliquer sur un élément de la page',
  riskLevel: 'high',
  args: { selector: '#suivant' },
  scopes: ['once', 'site'],
  site: 'exemple.fr',
};

function show(payload: PermissionRequestEvent): void {
  render(<PermissionPrompt />);
  act(() => bus.handler?.({ payload }));
}

beforeEach(() => {
  bus.respond.mockClear();
});

describe('PermissionPrompt — données personnelles', () => {
  it('affiche ce que le masquage a fait, au-dessus des paramètres masqués', () => {
    show(request({ preview: 'Masqué avant envoi : 1 IBAN.' }));
    expect(screen.getByText('Masqué avant envoi : 1 IBAN.')).toBeInTheDocument();
    expect(screen.getByText(/\[IBAN masqué\]/)).toBeInTheDocument();
  });

  it('sans masquage, pas de bandeau', () => {
    show(request({ args: { message: 'salut' } }));
    expect(screen.queryByText(/Masqué avant envoi/)).not.toBeInTheDocument();
  });
});

describe('PermissionPrompt — accord par site', () => {
  it('propose « Autoriser pour ce site » à côté de l’accord ponctuel, avec le site', () => {
    show(clickRequest);
    expect(screen.getByRole('button', { name: 'Autoriser une fois' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Autoriser pour ce site' })).toBeInTheDocument();
    expect(screen.getAllByText('exemple.fr').length).toBeGreaterThan(0);
    // Risque élevé : pas de « session ».
    expect(screen.queryByText(/pour cette session/)).not.toBeInTheDocument();
  });

  it('« Autoriser pour ce site » répond avec la portée site', async () => {
    show(clickRequest);
    fireEvent.click(screen.getByRole('button', { name: 'Autoriser pour ce site' }));
    await waitFor(() => expect(bus.respond).toHaveBeenCalledWith('req-1', true, 'site'));
  });

  it('« Autoriser une fois » : portée once', async () => {
    show(clickRequest);
    fireEvent.click(screen.getByRole('button', { name: 'Autoriser une fois' }));
    await waitFor(() => expect(bus.respond).toHaveBeenCalledWith('req-1', true, 'once'));
  });

  it('navigation en lecture seule (moyen) : site et « tous les sites pour la session »', async () => {
    show({
      ...clickRequest,
      tool: 'browser_navigate',
      riskLevel: 'medium',
      scopes: ['once', 'site', 'session'],
    });
    fireEvent.click(screen.getByText('Autoriser sur tous les sites pour cette session'));
    await waitFor(() => expect(bus.respond).toHaveBeenCalledWith('req-1', true, 'session'));
  });

  it('sans site proposé : la carte d’avant (Autoriser, et session pour un risque moyen)', async () => {
    show({
      requestId: 'req-2',
      tool: 'cancel_scheduled_task',
      description: 'Annuler une tâche',
      riskLevel: 'medium',
      args: {},
      scopes: ['once', 'session'],
    });
    expect(screen.getByRole('button', { name: 'Autoriser' })).toBeInTheDocument();
    expect(screen.queryByText('Autoriser pour ce site')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Autoriser pour cette session'));
    await waitFor(() => expect(bus.respond).toHaveBeenCalledWith('req-2', true, 'session'));
  });
});

describe('offeredScopes', () => {
  it('agent ancien (sans scopes) : session pour un risque moyen seulement', () => {
    const base = { requestId: 'r', tool: 't', description: '', args: {} };
    expect(offeredScopes({ ...base, riskLevel: 'medium' })).toEqual(['once', 'session']);
    expect(offeredScopes({ ...base, riskLevel: 'high' })).toEqual(['once']);
  });
});
