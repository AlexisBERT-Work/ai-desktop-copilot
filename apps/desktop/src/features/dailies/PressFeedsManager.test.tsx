// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import {
  EMPTY_PRESS_FEED,
  PRESS_SOURCE_CATALOG,
  type PressFeed,
  type PressFeedInput,
} from '@catdesk/shared-types';
import { PressFeedsManager, type PressFeedsBackend } from './PressFeedsManager';

afterEach(cleanup);

function makeBackend(items: PressFeed[] = []) {
  return {
    list: vi.fn(async () => ({ items, error: null as string | null })),
    create: vi.fn(async (_input: PressFeedInput) => ({ error: null as string | null })),
    update: vi.fn(async () => ({ error: null as string | null })),
    remove: vi.fn(async () => ({ error: null as string | null })),
    runNow: vi.fn(async () => ({ error: null as string | null })),
    runLabel: 'Générer maintenant',
    runStartedMsg: 'Génération lancée.',
  } satisfies PressFeedsBackend & Record<string, unknown>;
}

const saved = (over: Partial<PressFeed> = {}): PressFeed => ({
  id: 'f1',
  ...EMPTY_PRESS_FEED,
  name: 'Veille IA',
  sourceIds: ['lemonde'],
  ...over,
});

describe('PressFeedsManager', () => {
  it('charge et affiche les journaux du backend', async () => {
    render(<PressFeedsManager backend={makeBackend([saved()])} />);
    expect(await screen.findByText('Veille IA')).toBeTruthy();
  });

  it('refuse de créer sans nom', async () => {
    const backend = makeBackend();
    render(<PressFeedsManager backend={backend} />);
    fireEvent.click(screen.getByText('Créer'));
    expect(await screen.findByText('Le nom du journal est requis.')).toBeTruthy();
    expect(backend.create).not.toHaveBeenCalled();
  });

  it('refuse de créer sans source ni URL de flux', async () => {
    const backend = makeBackend();
    render(<PressFeedsManager backend={backend} />);
    fireEvent.change(screen.getByPlaceholderText('Veille IA, Revue crypto…'), {
      target: { value: 'Mon journal' },
    });
    fireEvent.click(screen.getByText('Créer'));
    expect(await screen.findByText(/au moins une source intégrée/)).toBeTruthy();
    expect(backend.create).not.toHaveBeenCalled();
  });

  it('crée un journal : nom + une source du catalogue cliquée', async () => {
    const backend = makeBackend();
    const first = PRESS_SOURCE_CATALOG[0]!;
    render(<PressFeedsManager backend={backend} />);

    fireEvent.change(screen.getByPlaceholderText('Veille IA, Revue crypto…'), {
      target: { value: 'Mon journal' },
    });
    fireEvent.click(screen.getByText(first.label));
    fireEvent.click(screen.getByText('Créer'));

    await waitFor(() => expect(backend.create).toHaveBeenCalledTimes(1));
    const input = backend.create.mock.calls[0]![0] as PressFeedInput;
    expect(input.name).toBe('Mon journal');
    expect(input.sourceIds).toContain(first.id);
    // Après création : formulaire réinitialisé + liste rechargée.
    await waitFor(() => expect(backend.list).toHaveBeenCalledTimes(2));
  });

  it('le bouton de run lance le backend et affiche le message', async () => {
    const backend = makeBackend();
    render(<PressFeedsManager backend={backend} />);
    fireEvent.click(screen.getByText('Générer maintenant'));
    expect(await screen.findByText('Génération lancée.')).toBeTruthy();
    expect(backend.runNow).toHaveBeenCalledTimes(1);
  });
});
