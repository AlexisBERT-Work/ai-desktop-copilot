import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../shared/api/selection', () => ({
  selectionCancel: vi.fn(() => Promise.resolve()),
  selectionReplace: vi.fn(() => Promise.resolve('replaced')),
  selectionSetEnabled: vi.fn(() => Promise.resolve()),
  selectionTransform: vi.fn(() => Promise.resolve()),
}));

import { selectionReplace, selectionTransform } from '../../shared/api/selection';
import { SelectionPanel } from './SelectionPanel';
import { SELECTION_PRESETS, useSelectionStore } from './selectionStore';
import { useChatStore } from '../chat/store/chatStore';

describe('SelectionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSelectionStore.setState(useSelectionStore.getInitialState());
    useChatStore.setState({ selectedModel: 'qwen3:14b' });
  });

  it('montre la sélection et envoie une consigne prête à l’emploi', () => {
    useSelectionStore.getState().apply({ phase: 'captured', text: 'Je suis la.' });
    render(<SelectionPanel />);
    expect(screen.getByText('Je suis la.')).toBeInTheDocument();
    expect(screen.getByText(/11 caractères/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Corriger' }));
    expect(vi.mocked(selectionTransform)).toHaveBeenCalledWith(
      SELECTION_PRESETS[0]?.instruction,
      'qwen3:14b',
    );
  });

  it('envoie une consigne libre', () => {
    useSelectionStore.getState().apply({ phase: 'captured', text: 'Bonjour' });
    render(<SelectionPanel />);
    const input = screen.getByRole('textbox', { name: 'Consigne' });
    fireEvent.change(input, { target: { value: 'traduis en espagnol' } });
    fireEvent.submit(input);
    expect(vi.mocked(selectionTransform)).toHaveBeenCalledWith('traduis en espagnol', 'qwen3:14b');
  });

  it("montre l'avant/après et ne remplace qu'à la validation", () => {
    useSelectionStore.setState({ phase: 'review', original: 'Je suis la.', result: 'Je suis là.' });
    render(<SelectionPanel />);
    expect(screen.getByText('Avant')).toBeInTheDocument();
    expect(screen.getByText('Après')).toBeInTheDocument();
    expect(screen.getByText('Je suis là.')).toBeInTheDocument();
    expect(vi.mocked(selectionReplace)).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: /Remplacer/ });
    // Entrée valide : le bouton a le focus d'office.
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(vi.mocked(selectionReplace)).toHaveBeenCalledTimes(1);
  });

  it('dit pourquoi rien ne se passe', () => {
    useSelectionStore.getState().apply({ phase: 'done', outcome: 'elevated' });
    render(<SelectionPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent(/administrateur/);
  });
});
