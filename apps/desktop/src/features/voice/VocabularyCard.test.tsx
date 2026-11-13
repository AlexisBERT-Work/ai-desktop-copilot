import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceVocabulary } from '@catdesk/shared-types';

vi.mock('../../shared/api/voice', () => ({
  voiceVocabularyGet: vi.fn(),
  voiceVocabularySet: vi.fn(),
}));

import { voiceVocabularyGet, voiceVocabularySet } from '../../shared/api/voice';
import { VocabularyCard } from './VocabularyCard';
import { summaryLine } from './vocabularySummary';

const get = vi.mocked(voiceVocabularyGet);
const set = vi.mocked(voiceVocabularySet);

const SAVED: VoiceVocabulary = {
  text: 'CatDesk\n',
  path: 'C:/data/voice/vocabulaire.txt',
  terms: 1,
  aliases: 0,
  problems: [],
};

describe('VocabularyCard', () => {
  beforeEach(() => {
    get.mockReset();
    set.mockReset();
    get.mockResolvedValue(SAVED);
  });

  it('affiche le fichier enregistré et ce que Rust en a retenu', async () => {
    render(<VocabularyCard disabled={false} />);
    const field = await screen.findByLabelText('Vocabulaire');
    expect(field).toHaveValue('CatDesk\n');
    expect(screen.getByText('1 nom.')).toBeInTheDocument();
    expect(screen.getByText(/vocabulaire\.txt/)).toBeInTheDocument();
    // Rien de modifié : rien à enregistrer.
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  });

  it('enregistrer envoie le texte et montre les lignes ignorées', async () => {
    set.mockResolvedValue({
      ...SAVED,
      text: 'CatDesk\nSupabase = supa base\nAI\n',
      terms: 2,
      aliases: 1,
      problems: ['« AI » : trop court pour être reconnu seul.'],
    });
    render(<VocabularyCard disabled={false} />);
    const field = await screen.findByLabelText('Vocabulaire');
    await userEvent.type(field, 'Supabase = supa base{enter}AI{enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(set).toHaveBeenCalledWith('CatDesk\nSupabase = supa base\nAI\n');
    expect(await screen.findByText('2 noms, 1 variante.')).toBeInTheDocument();
    expect(screen.getByText(/« AI » : trop court/)).toBeInTheDocument();
  });

  it('un refus de Rust s’affiche, le texte reste à corriger', async () => {
    set.mockRejectedValue(new Error('Vocabulaire trop long : 32 Ko au plus.'));
    render(<VocabularyCard disabled={false} />);
    const field = await screen.findByLabelText('Vocabulaire');
    await userEvent.type(field, 'Ollama');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('32 Ko');
    expect(field).toHaveValue('CatDesk\nOllama');
  });

  it('coupée : champ et bouton grisés', async () => {
    render(<VocabularyCard disabled />);
    const field = await screen.findByLabelText('Vocabulaire');
    expect(field).toBeDisabled();
  });

  it('résumé au singulier, au pluriel, et vide', () => {
    expect(summaryLine({ terms: 0, aliases: 0 })).toMatch(/vide/);
    expect(summaryLine({ terms: 1, aliases: 1 })).toBe('1 nom, 1 variante.');
    expect(summaryLine({ terms: 3, aliases: 0 })).toBe('3 noms.');
  });
});
