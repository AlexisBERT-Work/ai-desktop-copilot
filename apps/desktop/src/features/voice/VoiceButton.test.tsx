import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { VoiceStatus } from '@catdesk/shared-types';

vi.mock('../../shared/api/voice', () => ({
  voiceConfigure: vi.fn(() => Promise.resolve()),
  voiceListenStart: vi.fn(() => Promise.resolve()),
  voiceListenStop: vi.fn(() => Promise.resolve()),
  voiceSetDictation: vi.fn(() => Promise.resolve()),
  voiceSpeak: vi.fn(() => Promise.resolve()),
  voiceSpeakEnd: vi.fn(() => Promise.resolve()),
  voiceStatus: vi.fn(),
  voiceStopSpeaking: vi.fn(() => Promise.resolve()),
  voiceWarmup: vi.fn(() => Promise.resolve()),
}));

import { VoiceButton } from './VoiceButton';
import { useVoiceStore } from './voiceStore';

const STATUS = { sttAvailable: true, ttsAvailable: true } as VoiceStatus;

describe('VoiceButton', () => {
  it('pendant une dictée : grisé, et dit pourquoi', () => {
    useVoiceStore.setState({ enabled: true, status: STATUS, state: 'dictating', hint: null });
    render(<VoiceButton />);
    const button = screen.getByRole('button', { name: /Dictée en cours/ });
    expect(button).toBeDisabled();
  });

  it('au repos : utilisable', () => {
    useVoiceStore.setState({ enabled: true, status: STATUS, state: 'idle', hint: null });
    render(<VoiceButton />);
    expect(screen.getByRole('button', { name: /Parler à CatDesk/ })).toBeEnabled();
  });
});
