import { useEffect } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2;
const STEP = 0.1;

/** Arrondit au dixième et borne dans [ZOOM_MIN, ZOOM_MAX]. Pur, exporté pour tests. */
export function clampZoom(z: number): number {
  const rounded = Math.round(z * 10) / 10;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rounded));
}

interface ZoomState {
  zoom: number;
  setZoom: (z: number) => void;
}

export const useZoomStore = create<ZoomState>()(
  persist(z => ({ zoom: 1, setZoom: value => z({ zoom: clampZoom(value) }) }), {
    name: 'catdesk-ui-zoom',
  }),
);

/**
 * Zoom de l'interface (fenêtre courante) : Ctrl+molette, Ctrl + « + / − »,
 * Ctrl+0 pour revenir à 100 %. Persisté entre les sessions. Appliqué via la
 * propriété CSS `zoom` (native WebView2/Chromium) sur la racine du document.
 */
export function useUiZoom(): number {
  const zoom = useZoomStore(s => s.zoom);
  const setZoom = useZoomStore(s => s.setZoom);

  useEffect(() => {
    document.documentElement.style.setProperty('zoom', String(zoom));
    return () => {
      document.documentElement.style.removeProperty('zoom');
    };
  }, [zoom]);

  useEffect(() => {
    const nudge = (delta: number) => setZoom(useZoomStore.getState().zoom + delta);

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      nudge(e.deltaY < 0 ? STEP : -STEP);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        nudge(STEP);
      } else if (e.key === '-') {
        e.preventDefault();
        nudge(-STEP);
      } else if (e.key === '0') {
        e.preventDefault();
        setZoom(1);
      }
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [setZoom]);

  return zoom;
}
