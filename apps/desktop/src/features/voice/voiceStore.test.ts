import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceStatus } from '@catdesk/shared-types';

const STATUS: VoiceStatus = {
  state: 'idle',
  sttAvailable: true,
  ttsAvailable: true,
  modelsDir: 'C:/voice',
  voices: ['vits-piper-fr_FR-miro-high'],
  config: { voice: 'vits-piper-fr_FR-miro-high', speed: 1 },
};

vi.mock('../../shared/api/voice', () => ({
  voiceConfigure: vi.fn(() => Promise.resolve()),
  voiceListenStart: vi.fn(() => Promise.resolve()),
  voiceListenStop: vi.fn(() => Promise.resolve()),
  voiceSetDictation: vi.fn(() => Promise.resolve()),
  voiceSpeak: vi.fn(() => Promise.resolve()),
  voiceSpeakEnd: vi.fn(() => Promise.resolve()),
  voiceStatus: vi.fn(() => Promise.resolve(STATUS)),
  voiceStopSpeaking: vi.fn(() => Promise.resolve()),
  voiceWarmup: vi.fn(() => Promise.resolve()),
}));

import { voiceSetDictation } from '../../shared/api/voice';
import { useVoiceStore } from './voiceStore';

const setDictation = vi.mocked(voiceSetDictation);

describe('voiceStore — dictée', () => {
  beforeEach(() => {
    setDictation.mockReset();
    setDictation.mockResolvedValue(undefined);
    useVoiceStore.setState({ enabled: true, dictation: false, status: STATUS, hint: null });
  });

  it('désactivée par défaut, et persistée', () => {
    expect(useVoiceStore.getInitialState().dictation).toBe(false);
    const persisted = useVoiceStore.persist.getOptions().partialize?.(useVoiceStore.getState());
    expect(persisted).toHaveProperty('dictation', false);
  });

  it('cocher l’active côté Rust ; décocher la retire', async () => {
    await useVoiceStore.getState().setDictation(true);
    expect(setDictation).toHaveBeenLastCalledWith(true);
    expect(useVoiceStore.getState().dictation).toBe(true);

    await useVoiceStore.getState().setDictation(false);
    expect(setDictation).toHaveBeenLastCalledWith(false);
  });

  it('raccourci déjà pris : la case se décoche et dit pourquoi', async () => {
    setDictation.mockRejectedValueOnce(new Error('Raccourci Ctrl+Alt+Espace indisponible'));
    await useVoiceStore.getState().setDictation(true);
    expect(useVoiceStore.getState().dictation).toBe(false);
    expect(useVoiceStore.getState().hint).toMatch(/Ctrl\+Alt\+Espace/);
  });

  it('voix coupée ou modèles absents : la dictée est retirée, la préférence gardée', async () => {
    useVoiceStore.setState({ dictation: true });
    useVoiceStore.getState().setEnabled(false);
    await vi.waitFor(() => expect(setDictation).toHaveBeenLastCalledWith(false));
    expect(useVoiceStore.getState().dictation).toBe(true);

    useVoiceStore.getState().setEnabled(true);
    await vi.waitFor(() => expect(setDictation).toHaveBeenLastCalledWith(true));

    useVoiceStore.setState({ status: { ...STATUS, sttAvailable: false } });
    await useVoiceStore.getState().setDictation(true);
    expect(setDictation).toHaveBeenLastCalledWith(false);
  });

  it('au démarrage : rétablie si cochée, rien sinon', async () => {
    await useVoiceStore.getState().init();
    expect(setDictation).not.toHaveBeenCalled();

    useVoiceStore.setState({ dictation: true });
    await useVoiceStore.getState().init();
    expect(setDictation).toHaveBeenCalledWith(true);
  });
});
