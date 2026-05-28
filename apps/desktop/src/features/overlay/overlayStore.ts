import { create } from 'zustand';
import type { OverlayMode } from '@neurodesk/shared-types';

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

  setMode: mode =>
    set({ mode, isVisible: mode !== 'hidden' }),

  toggle: () =>
    set(s => ({
      isVisible: !s.isVisible,
      mode: !s.isVisible ? 'mini' : 'hidden',
    })),

  hide: () => set({ isVisible: false, mode: 'hidden' }),

  show: (mode = 'mini') => set({ isVisible: true, mode }),
}));
