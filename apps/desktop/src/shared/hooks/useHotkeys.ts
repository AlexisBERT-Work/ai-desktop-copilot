import { useEffect } from 'react';
import { useOverlayStore } from '../../features/overlay/overlayStore';

/**
 * Local keyboard shortcuts (within the webview window).
 * Global OS-level hotkeys are registered in Rust via tauri-plugin-global-shortcut.
 */
export function useHotkeys() {
  const { toggle, setMode } = useOverlayStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+K → Command palette
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        setMode('command');
      }
      // Ctrl+N → New conversation
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        // Will be handled by chat store
      }
      // Escape → close/minimize
      if (e.key === 'Escape') {
        setMode('hidden');
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle, setMode]);
}
