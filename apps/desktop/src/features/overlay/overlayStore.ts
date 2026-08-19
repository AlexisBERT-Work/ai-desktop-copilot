import { create } from 'zustand';
import type { OverlayMode } from '@catdesk/shared-types';
import { useAppearanceStore } from '../appearance/appearanceStore';

/** Panneau ouvert à l'invocation — réglable dans Apparence (« À l'ouverture »). */
const launchMode = (): OverlayMode => useAppearanceStore.getState().launchMode;

interface OverlayState {
  mode: OverlayMode;
  isVisible: boolean;
  setMode: (mode: OverlayMode) => void;
  toggle: () => void;
  hide: () => void;
  show: (mode?: OverlayMode) => void;
}

export const useOverlayStore = create<OverlayState>(set => ({
  mode: 'hidden',
  isVisible: false,

  setMode: mode => set({ mode, isVisible: mode !== 'hidden' }),

  toggle: () =>
    set(s => ({
      isVisible: !s.isVisible,
      mode: !s.isVisible ? launchMode() : 'hidden',
    })),

  hide: () => set({ isVisible: false, mode: 'hidden' }),

  show: mode => set({ isVisible: true, mode: mode ?? launchMode() }),
}));
