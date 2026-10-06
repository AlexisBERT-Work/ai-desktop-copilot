import { useEffect } from 'react';
import { useOverlayStore } from '../../features/overlay/overlayStore';

/**
 * Local keyboard shortcuts (within the webview window).
 * Global OS-level hotkeys are registered in Rust via tauri-plugin-global-shortcut.
 */
export function useHotkeys() {
  // Sélecteur atomique : ne re-rend que si `setMode` change (jamais), pas à
  // chaque changement du store.
  const setMode = useOverlayStore(s => s.setMode);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+K → Command palette
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        setMode('command');
      }
      // Ctrl+, → Settings
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        setMode('settings');
      }
      // Escape → close/minimize
      if (e.key === 'Escape') {
        setMode('hidden');
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setMode]);
}
