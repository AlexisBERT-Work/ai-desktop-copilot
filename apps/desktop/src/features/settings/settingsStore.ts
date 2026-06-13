import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';

interface SettingsState {
  defaultModel: string;
  temperature: number;
  maxIterations: number;
  safeMode: boolean;
  streamingEnabled: boolean;

  setDefaultModel: (model: string) => void;
  setTemperature: (value: number) => void;
  setMaxIterations: (value: number) => void;
  setSafeMode: (enabled: boolean) => void;
  setStreamingEnabled: (enabled: boolean) => void;
  syncToRuntime: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      defaultModel: 'qwen2.5:7b',
      temperature: 0.7,
      maxIterations: 10,
      safeMode: false,
      streamingEnabled: true,

      setDefaultModel: (model) => set({ defaultModel: model }),
      setTemperature: (value) => set({ temperature: value }),
      setMaxIterations: (value) => set({ maxIterations: value }),

      setSafeMode: (enabled) => {
        set({ safeMode: enabled });
        // La commande Rust prend `args: UpdateSettingsArgs` → envelopper sous `args`.
        void invoke('update_settings', { args: { safeMode: enabled } }).catch(() => {
          // Agent not yet running — will sync on next start via syncToRuntime
        });
      },

      setStreamingEnabled: (enabled) => set({ streamingEnabled: enabled }),

      syncToRuntime: () => {
        const { safeMode } = get();
        void invoke('update_settings', { args: { safeMode } }).catch(() => {});
      },
    }),
    { name: 'catdesk-settings' },
  ),
);
