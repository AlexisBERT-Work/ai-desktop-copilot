import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelectionOutcome } from '@catdesk/shared-types';

vi.mock('../../shared/api/selection', () => ({
  selectionCancel: vi.fn(() => Promise.resolve()),
  selectionReplace: vi.fn(() => Promise.resolve('replaced')),
  selectionSetEnabled: vi.fn(() => Promise.resolve()),
  selectionTransform: vi.fn(() => Promise.resolve()),
}));

import { selectionCancel, selectionReplace, selectionTransform } from '../../shared/api/selection';
import { outcomeMessage, useSelectionStore } from './selectionStore';

const transform = vi.mocked(selectionTransform);
const replace = vi.mocked(selectionReplace);
const cancel = vi.mocked(selectionCancel);

const store = () => useSelectionStore.getState();

describe('selectionStore — parcours', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSelectionStore.setState(useSelectionStore.getInitialState());
  });

  it('sélection copiée → consigne → avant/après → remplacé', async () => {
    expect(store().apply({ phase: 'captured', text: 'Je suis la.' })).toBe(true);
    expect(store().phase).toBe('instruction');
    expect(store().original).toBe('Je suis la.');

    await store().transform('  corrige ', 'qwen3:14b');
    // Seule la consigne part : le texte reste dans le cœur.
    expect(transform).toHaveBeenCalledWith('corrige', 'qwen3:14b');
    expect(store().phase).toBe('working');

    expect(store().apply({ phase: 'result', text: 'Je suis là.' })).toBe(true);
    expect(store().phase).toBe('review');
    expect(store().result).toBe('Je suis là.');

    await store().replace();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(store().phase).toBe('done');
    expect(store().notice).toMatch(/Texte remplacé/);
  });

  it("rien n'est collé hors de l'étape avant/après", async () => {
    store().apply({ phase: 'captured', text: 'texte' });
    await store().replace();
    expect(replace).not.toHaveBeenCalled();
  });

  it('une réponse tardive (transformation abandonnée) ne rouvre rien', () => {
    expect(store().apply({ phase: 'result', text: 'vieux' })).toBe(false);
    expect(
      store().apply({ phase: 'done', outcome: 'agent_error', message: 'Transformation annulée.' }),
    ).toBe(false);
    expect(store().phase).toBe('idle');
  });

  it("un échec de l'agent ramène à la consigne, même sélection", async () => {
    store().apply({ phase: 'captured', text: 'texte' });
    await store().transform('corrige', 'm');
    store().apply({ phase: 'done', outcome: 'agent_error', message: 'Ollama injoignable' });
    expect(store().phase).toBe('instruction');
    expect(store().original).toBe('texte');
    expect(store().notice).toBe('Ollama injoignable');
  });

  it("l'envoi refusé par le cœur s'affiche, en français", async () => {
    transform.mockRejectedValueOnce('Plus de sélection en attente : refaites Ctrl+Alt+T');
    store().apply({ phase: 'captured', text: 'texte' });
    await store().transform('corrige', 'm');
    expect(store().phase).toBe('instruction');
    expect(store().notice).toBe('Plus de sélection en attente : refaites Ctrl+Alt+T');
  });

  it('un collage refusé garde le résultat (copier, réessayer)', async () => {
    replace.mockResolvedValueOnce('focus_changed');
    store().apply({ phase: 'captured', text: 'texte' });
    await store().transform('corrige', 'm');
    store().apply({ phase: 'result', text: 'Texte.' });
    await store().replace();
    expect(store().phase).toBe('review');
    expect(store().result).toBe('Texte.');
    expect(store().notice).toBe(outcomeMessage('focus_changed'));
  });

  it('rien de sélectionné : la bulle le dit, sans étape suivante', () => {
    expect(store().apply({ phase: 'done', outcome: 'no_selection' })).toBe(true);
    expect(store().phase).toBe('failed');
    expect(store().notice).toMatch(/Aucun texte sélectionné/);
  });

  it('autre consigne, puis abandon : le cœur est prévenu une fois', async () => {
    store().apply({ phase: 'captured', text: 'texte' });
    await store().transform('corrige', 'm');
    store().apply({ phase: 'result', text: 'Texte.' });
    store().editInstruction();
    expect(store().phase).toBe('instruction');
    expect(store().original).toBe('texte');
    store().cancel();
    store().cancel();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(store().phase).toBe('idle');
  });
});

describe('outcomeMessage', () => {
  it('a une phrase pour chaque issue', () => {
    const all: SelectionOutcome[] = [
      'replaced',
      'no_selection',
      'too_long',
      'focus_changed',
      'elevated',
      'keys_held',
      'blocked',
      'clipboard_busy',
      'expired',
      'agent_error',
    ];
    for (const outcome of all) expect(outcomeMessage(outcome).length).toBeGreaterThan(10);
    expect(outcomeMessage('too_long')).toMatch(/8\s000 caractères/);
    expect(outcomeMessage('agent_error', 'Consigne vide.')).toBe('Consigne vide.');
  });
});
