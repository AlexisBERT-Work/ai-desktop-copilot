import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/api/settings', () => ({
  updateRuntimeSettings: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../shared/api/models', () => ({
  getOllamaModelsInfo: vi.fn(() =>
    Promise.resolve([
      { name: 'qwen3:14b', sizeBytes: 9e9 },
      { name: 'mistral:7b', sizeBytes: 4e9 },
    ]),
  ),
  getGpuVramBytes: vi.fn(() => Promise.resolve(null)),
  getRecommendedModel: vi.fn(() => Promise.resolve('qwen3:14b')),
}));

import { migrateSettings, useSettingsStore } from './settingsStore';
import { useChatStore } from '../chat/store/chatStore';

describe('migrateSettings', () => {
  it('v0 : l’ancien défaut codé en dur redevient « automatique », le streaming disparaît', () => {
    expect(
      migrateSettings(
        {
          defaultModel: 'qwen3:14b',
          temperature: 0.3,
          maxIterations: 4,
          safeMode: true,
          streamingEnabled: false,
        },
        0,
      ),
    ).toEqual({ defaultModel: null, temperature: 0.3, maxIterations: 4, safeMode: true });
  });

  it('v0 illisible : défauts sûrs', () => {
    expect(migrateSettings(null, 0)).toEqual({
      defaultModel: null,
      temperature: 0.7,
      maxIterations: 10,
      safeMode: false,
    });
  });
});

describe('choix du modèle (sélecteur du chat = Réglages › Modèle)', () => {
  beforeEach(async () => {
    useSettingsStore.setState({ defaultModel: null });
    await useChatStore.getState().loadModels();
  });

  it('sans choix : le modèle recommandé', () => {
    expect(useChatStore.getState().selectedModel).toBe('qwen3:14b');
  });

  it('un choix est appliqué ET persisté dans les réglages', () => {
    useChatStore.getState().chooseModel('mistral:7b');
    expect(useChatStore.getState().selectedModel).toBe('mistral:7b');
    expect(useSettingsStore.getState().defaultModel).toBe('mistral:7b');
  });

  it('revenir à « automatique » repasse sur le recommandé', () => {
    useChatStore.getState().chooseModel('mistral:7b');
    useChatStore.getState().chooseModel(null);
    expect(useChatStore.getState().selectedModel).toBe('qwen3:14b');
    expect(useSettingsStore.getState().defaultModel).toBeNull();
  });

  it('un choix persisté qui n’est plus installé retombe sur le recommandé', async () => {
    useSettingsStore.setState({ defaultModel: 'disparu:1b' });
    await useChatStore.getState().loadModels();
    expect(useChatStore.getState().selectedModel).toBe('qwen3:14b');
  });

  it('les réglages bornent température et itérations', () => {
    useSettingsStore.getState().setTemperature(9);
    useSettingsStore.getState().setMaxIterations(0);
    expect(useSettingsStore.getState().temperature).toBe(2);
    expect(useSettingsStore.getState().maxIterations).toBe(1);
  });
});
