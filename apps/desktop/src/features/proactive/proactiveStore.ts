import { create } from 'zustand';

export interface ProactiveSuggestion {
  kind: string;
  signature: string | null;
  minutesOnTopic?: number;
  repetitions?: number;
  failureCount?: number;
  reason?: string;
  suggestion: string | null;
}

interface ProactiveState {
  current: ProactiveSuggestion | null;
  show: (s: ProactiveSuggestion) => void;
  dismiss: () => void;
}

export const useProactiveStore = create<ProactiveState>(set => ({
  current: null,
  show: s => set({ current: s }),
  dismiss: () => set({ current: null }),
}));
