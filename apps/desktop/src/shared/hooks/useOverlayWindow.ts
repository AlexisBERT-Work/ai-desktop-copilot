import { useEffect } from 'react';
import {
  getCurrentWindow,
  LogicalSize,
  LogicalPosition,
  currentMonitor,
} from '@tauri-apps/api/window';
import { useOverlayStore } from '../../features/overlay/overlayStore';
import { useAppearanceStore } from '../../features/appearance/appearanceStore';
import {
  BUBBLE_DIMENSIONS,
  type BubbleSize,
  type CornerName,
} from '../../features/appearance/palettes';
import type { OverlayMode } from '@catdesk/shared-types';

/**
 * Logical (CSS px) size the OS window takes for each panel, including a small
 * transparent margin around the content so the drop shadow isn't clipped.
 * `mini` et `chat` suivent le gabarit choisi dans Apparence ; les panneaux
 * annexes gardent une taille fixe.
 */
function panelSize(
  mode: Exclude<OverlayMode, 'hidden'>,
  size: BubbleSize,
): { w: number; h: number } {
  const d = BUBBLE_DIMENSIONS[size];
  switch (mode) {
    case 'mini':
      return { w: d.miniW, h: d.miniH };
    case 'chat':
      return { w: d.chatW, h: d.chatH };
    case 'command':
      return { w: 648, h: 470 };
    case 'settings':
      return { w: 748, h: 568 };
  }
}

/** Gap from the screen edges; extra bottom gap keeps the bubble above the taskbar. */
const EDGE_GAP = 16;
const TASKBAR_GAP = 48;

/**
 * Coin d'ancrage → position en px logiques, bornée à l'écran. Le bas réserve
 * TASKBAR_GAP pour ne pas passer sous la barre des tâches.
 */
function anchorPosition(
  corner: CornerName,
  size: { w: number; h: number },
  monW: number,
  monH: number,
): { x: number; y: number } {
  const right = Math.max(EDGE_GAP, monW - size.w - EDGE_GAP);
  const bottom = Math.max(EDGE_GAP, monH - size.h - EDGE_GAP - TASKBAR_GAP);
  switch (corner) {
    case 'bottom-right':
      return { x: right, y: bottom };
    case 'bottom-left':
      return { x: EDGE_GAP, y: bottom };
    case 'top-right':
      return { x: right, y: EDGE_GAP };
    case 'top-left':
      return { x: EDGE_GAP, y: EDGE_GAP };
    case 'center':
      return {
        x: Math.max(EDGE_GAP, (monW - size.w) / 2),
        y: Math.max(EDGE_GAP, (monH - size.h) / 2),
      };
  }
}

/**
 * Makes the OS window behave like a floating bubble: hidden until summoned,
 * resized to hug whichever panel is active, and docked to the bottom-right
 * corner. When the overlay is hidden the window is fully hidden, so it never
 * sits as an invisible click-blocker over the desktop.
 */
export function useOverlayWindow() {
  const isVisible = useOverlayStore(s => s.isVisible);
  const mode = useOverlayStore(s => s.mode);
  const bubbleSize = useAppearanceStore(s => s.bubbleSize);
  const corner = useAppearanceStore(s => s.corner);

  useEffect(() => {
    const win = getCurrentWindow();
    let cancelled = false;

    void (async () => {
      if (!isVisible || mode === 'hidden') {
        await win.hide();
        return;
      }

      const size = panelSize(mode, bubbleSize);
      await win.setSize(new LogicalSize(size.w, size.h));

      const mon = await currentMonitor();
      if (mon && !cancelled) {
        const sf = mon.scaleFactor;
        const { x, y } = anchorPosition(corner, size, mon.size.width / sf, mon.size.height / sf);
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
  }, [isVisible, mode, bubbleSize, corner]);
}
