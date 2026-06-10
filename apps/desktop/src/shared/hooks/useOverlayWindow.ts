import { useEffect } from 'react';
import {
  getCurrentWindow,
  LogicalSize,
  LogicalPosition,
  currentMonitor,
} from '@tauri-apps/api/window';
import { useOverlayStore } from '../../features/overlay/overlayStore';
import type { OverlayMode } from '@neurodesk/shared-types';

/**
 * Logical (CSS px) size the OS window takes for each panel, including a small
 * transparent margin around the content so the drop shadow isn't clipped.
 * Keep these roughly in sync with the panel widths/heights in their components.
 */
const PANEL_SIZE: Record<Exclude<OverlayMode, 'hidden'>, { w: number; h: number }> = {
  mini: { w: 600, h: 170 },
  chat: { w: 724, h: 648 },
  command: { w: 648, h: 470 },
  settings: { w: 748, h: 568 },
};

/** Gap from the screen edges; extra bottom gap keeps the bubble above the taskbar. */
const EDGE_GAP = 16;
const TASKBAR_GAP = 48;

/**
 * Makes the OS window behave like a floating bubble: hidden until summoned,
 * resized to hug whichever panel is active, and docked to the bottom-right
 * corner. When the overlay is hidden the window is fully hidden, so it never
 * sits as an invisible click-blocker over the desktop.
 */
export function useOverlayWindow() {
  const isVisible = useOverlayStore(s => s.isVisible);
  const mode = useOverlayStore(s => s.mode);

  useEffect(() => {
    const win = getCurrentWindow();
    let cancelled = false;

    void (async () => {
      if (!isVisible || mode === 'hidden') {
        await win.hide();
        return;
      }

      const size = PANEL_SIZE[mode];
      await win.setSize(new LogicalSize(size.w, size.h));

      const mon = await currentMonitor();
      if (mon && !cancelled) {
        const sf = mon.scaleFactor;
        const monW = mon.size.width / sf;
        const monH = mon.size.height / sf;
        const x = Math.max(EDGE_GAP, monW - size.w - EDGE_GAP);
        const y = Math.max(EDGE_GAP, monH - size.h - EDGE_GAP - TASKBAR_GAP);
        await win.setPosition(new LogicalPosition(x, y));
      }

      if (cancelled) return;
      await win.show();
      await win.setFocus();
    })().catch(() => {
      /* window ops are best-effort; ignore transient failures */
    });

    return () => {
      cancelled = true;
    };
  }, [isVisible, mode]);
}
