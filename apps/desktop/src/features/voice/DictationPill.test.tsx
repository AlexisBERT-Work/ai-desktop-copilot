import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceDictationEvent } from '@catdesk/shared-types';

type Handler = (e: { payload: unknown }) => void;
const handlers = new Map<string, Handler>();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, handler: Handler) => {
    handlers.set(name, handler);
    return Promise.resolve(() => handlers.delete(name));
  }),
}));

import { DictationPill } from './DictationPill';
import { pillView, RESULT_MS } from './dictationPillView';

function emit(name: string, payload: unknown) {
  act(() => handlers.get(name)?.({ payload }));
}

describe('pillView', () => {
  it('au repos : rien', () => {
    expect(pillView(null)).toBeNull();
  });

  it('enregistrement, transcription, puis issue', () => {
    expect(pillView({ phase: 'recording', chars: 0 })?.tone).toBe('recording');
    expect(pillView({ phase: 'transcribing', chars: 0 })).toEqual({
      tone: 'busy',
      text: 'Transcription…',
    });
    expect(pillView({ phase: 'done', outcome: 'inserted', chars: 42 })).toEqual({
      tone: 'ok',
      text: '42 caractères écrits',
    });
    expect(pillView({ phase: 'done', outcome: 'inserted', chars: 1 })?.text).toBe(
      '1 caractère écrit',
    );
  });

  it('chaque refus dit pourquoi rien n’a été écrit', () => {
    const refusals: VoiceDictationEvent[] = [
      { phase: 'done', outcome: 'focus_changed', chars: 12 },
      { phase: 'done', outcome: 'elevated', chars: 12 },
      { phase: 'done', outcome: 'keys_held', chars: 12 },
      { phase: 'done', outcome: 'empty', chars: 0 },
    ];
    for (const e of refusals) {
      const view = pillView(e);
      expect(view?.tone).toBe('warn');
      expect(view?.text.length).toBeGreaterThan(5);
    }
    expect(pillView(refusals[1] ?? null)?.text).toMatch(/administrateur/);
    // Le texte dicté n'apparaît jamais : seul le nombre de caractères.
    expect(pillView({ phase: 'done', chars: 0 })?.text).toMatch(/Rien entendu/);
  });
});

describe('DictationPill', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    handlers.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('suit la dictée puis redevient vide', async () => {
    const { container } = render(<DictationPill />);
    await act(async () => {}); // abonnements résolus
    expect(container).toBeEmptyDOMElement();

    emit('voice:dictation', { phase: 'recording', chars: 0 });
    expect(screen.getByRole('status')).toHaveTextContent('relâche pour écrire');
    emit('voice:level', { rms: 0.5 });

    emit('voice:dictation', { phase: 'transcribing', chars: 0 });
    expect(screen.getByRole('status')).toHaveTextContent('Transcription…');

    emit('voice:dictation', { phase: 'done', outcome: 'inserted', chars: 7 });
    expect(screen.getByRole('status')).toHaveTextContent('7 caractères écrits');

    act(() => vi.advanceTimersByTime(RESULT_MS));
    expect(container).toBeEmptyDOMElement();
  });

  it('une nouvelle dictée annule l’effacement de la précédente', async () => {
    render(<DictationPill />);
    await act(async () => {});
    emit('voice:dictation', { phase: 'done', outcome: 'empty', chars: 0 });
    act(() => vi.advanceTimersByTime(RESULT_MS - 100));
    emit('voice:dictation', { phase: 'recording', chars: 0 });
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole('status')).toHaveTextContent('relâche pour écrire');
  });
});
