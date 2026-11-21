import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { updateRuntimeSettings } from '../../shared/api/settings';

/**
 * Réglages persistés de l'utilisateur. Seuls ceux qui ont un effet réel
 * vivent ici : avant, « modèle par défaut », « température », « itérations
 * max » et « streaming » étaient enregistrés… et jamais transmis à l'agent.
 */
interface SettingsState {
  /** Modèle choisi explicitement ; null = celui que CatDesk recommande. */
  defaultModel: string | null;
  temperature: number;
  maxIterations: number;
  safeMode: boolean;

  setDefaultModel: (model: string | null) => void;
  setTemperature: (value: number) => void;
  setMaxIterations: (value: number) => void;
  setSafeMode: (enabled: boolean) => void;
  /** Pousse au runtime les réglages qui le concernent (le cœur les rejoue à chaque démarrage de l'agent). */
  syncToRuntime: () => void;
}

/** Forme persistée en v0 (avant 0.2.1) — pour la migration. */
interface PersistedV0 {
  defaultModel?: unknown;
  temperature?: unknown;
  maxIterations?: unknown;
  safeMode?: unknown;
}

type PersistedSettings = Pick<
  SettingsState,
  'defaultModel' | 'temperature' | 'maxIterations' | 'safeMode'
>;

/**
 * Migration des réglages persistés. v0 → v1 : `defaultModel` valait toujours
 * 'qwen3:14b' (le défaut, jamais un vrai choix) → null ; `streamingEnabled`
 * (sans effet) disparaît. Pur, exporté pour les tests.
 */
export function migrateSettings(persisted: unknown, version: number): PersistedSettings {
  const old = (persisted ?? {}) as PersistedV0;
  if (version >= 1) return old as PersistedSettings;
  return {
    defaultModel: null,
    temperature: typeof old.temperature === 'number' ? old.temperature : 0.7,
    maxIterations: typeof old.maxIterations === 'number' ? old.maxIterations : 10,
    safeMode: old.safeMode === true,
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      defaultModel: null,
      temperature: 0.7,
      maxIterations: 10,
      safeMode: false,

      setDefaultModel: model => set({ defaultModel: model }),
      setTemperature: value => set({ temperature: Math.min(2, Math.max(0, value)) }),
      setMaxIterations: value => set({ maxIterations: Math.min(25, Math.max(1, value)) }),

      setSafeMode: enabled => {
        set({ safeMode: enabled });
        void updateRuntimeSettings({ safeMode: enabled }).catch(() => {
          // Agent pas (encore) là : le cœur a mémorisé le réglage et le rejouera.
        });
      },

      syncToRuntime: () => {
        const { safeMode } = get();
        void updateRuntimeSettings({ safeMode }).catch(() => {});
      },
    }),
    {
      name: 'catdesk-settings',
      version: 1,
      partialize: s => ({
        defaultModel: s.defaultModel,
        temperature: s.temperature,
        maxIterations: s.maxIterations,
        safeMode: s.safeMode,
      }),
      migrate: (persisted, version) => migrateSettings(persisted, version) as SettingsState,
    },
  ),
);
