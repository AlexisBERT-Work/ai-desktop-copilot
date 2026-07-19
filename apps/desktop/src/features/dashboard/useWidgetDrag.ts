import { useCallback, useEffect, useRef, useState } from 'react';
import { useZoomStore } from '../../shared/hooks/useUiZoom';
import { useDashboardStore } from './dashboardStore';

/** Distance (px) avant qu'un appui ne devienne un drag — préserve les clics. */
const DRAG_THRESHOLD = 4;
/** Taille (px) des zones de défilement automatique aux bords du conteneur. */
const SCROLL_ZONE = 56;
/** Vitesse maximale du défilement automatique (px par frame). */
const SCROLL_SPEED = 16;

/**
 * Drag libre des widgets, façon PowerPoint : la carte suit le curseur et se pose
 * exactement où on la lâche (position px, snap léger appliqué par le store).
 * Pointer events maison — même approche que les poignées de redimensionnement.
 * Le widget saisi passe au premier plan ; défilement automatique près des bords ;
 * Échap repose le widget à sa position de départ.
 *
 * Coordonnées : les événements pointeur et getBoundingClientRect sont en px
 * viewport (zoom UI inclus) ; le canvas vit DANS l'arbre zoomé → on divise par
 * le zoom pour retomber en px layout. La position se recalcule depuis le rect
 * du canvas à chaque frame, donc l'auto-scroll ne fausse rien.
 */
export function useWidgetDrag(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  canvasRef: React.RefObject<HTMLDivElement | null>,
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const moveWidget = useDashboardStore(s => s.moveWidget);
  const bringToFront = useDashboardStore(s => s.bringToFront);

  // Nettoyage si le composant est démonté en plein drag.
  useEffect(() => () => stopRef.current(), []);

  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>, id: string) => {
      if (e.button !== 0) return;
      const widget = useDashboardStore.getState().config.widgets.find(w => w.id === id);
      if (widget === undefined) return;
      // Position de départ, pour pouvoir annuler par Échap.
      const origin = { x: widget.layout.x, y: widget.layout.y };
      const rect = e.currentTarget.getBoundingClientRect();
      const zoom0 = useZoomStore.getState().zoom;
      // Point de saisie dans la carte, en px layout.
      const grabX = (e.clientX - rect.left) / zoom0;
      const grabY = (e.clientY - rect.top) / zoom0;

      const s = {
        startX: e.clientX,
        startY: e.clientY,
        pointerX: e.clientX,
        pointerY: e.clientY,
        active: false,
        raf: 0,
      };

      const autoScroll = () => {
        const sc = scrollRef.current;
        if (sc === null) return;
        const r = sc.getBoundingClientRect();
        if (s.pointerY < r.top + SCROLL_ZONE) {
          const f = Math.min((r.top + SCROLL_ZONE - s.pointerY) / SCROLL_ZONE, 1);
          sc.scrollTop -= Math.ceil(f * SCROLL_SPEED);
        } else if (s.pointerY > r.bottom - SCROLL_ZONE) {
          const f = Math.min((s.pointerY - (r.bottom - SCROLL_ZONE)) / SCROLL_ZONE, 1);
          sc.scrollTop += Math.ceil(f * SCROLL_SPEED);
        }
        if (s.pointerX < r.left + SCROLL_ZONE) {
          const f = Math.min((r.left + SCROLL_ZONE - s.pointerX) / SCROLL_ZONE, 1);
          sc.scrollLeft -= Math.ceil(f * SCROLL_SPEED);
        } else if (s.pointerX > r.right - SCROLL_ZONE) {
          const f = Math.min((s.pointerX - (r.right - SCROLL_ZONE)) / SCROLL_ZONE, 1);
          sc.scrollLeft += Math.ceil(f * SCROLL_SPEED);
        }
      };

      /** Pose le widget sous le pointeur (px layout, snap/bornes au store). */
      const applyFromPointer = () => {
        const canvas = canvasRef.current;
        if (canvas === null) return;
        const zoom = useZoomStore.getState().zoom;
        const cRect = canvas.getBoundingClientRect();
        const x = (s.pointerX - cRect.left) / zoom - grabX;
        const y = (s.pointerY - cRect.top) / zoom - grabY;
        moveWidget(id, x, y);
      };

      const tick = () => {
        autoScroll();
        applyFromPointer();
        s.raf = requestAnimationFrame(tick);
      };

      const onMove = (ev: PointerEvent) => {
        s.pointerX = ev.clientX;
        s.pointerY = ev.clientY;
        if (s.active) return;
        if (Math.hypot(ev.clientX - s.startX, ev.clientY - s.startY) < DRAG_THRESHOLD) return;
        s.active = true;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
        bringToFront(id);
        setDraggingId(id);
        s.raf = requestAnimationFrame(tick);
      };

      // Échap : repose le widget à sa position de départ (écouté en capture,
      // pour que la page ne ferme pas le mode édition au passage).
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape' || !s.active) return;
        ev.stopPropagation();
        moveWidget(id, origin.x, origin.y);
        stop();
      };

      const stop = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
        window.removeEventListener('keydown', onKey, true);
        cancelAnimationFrame(s.raf);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        stopRef.current = () => {};
        setDraggingId(null);
      };
      stopRef.current = stop;

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
      window.addEventListener('keydown', onKey, true);
    },
    [scrollRef, canvasRef, moveWidget, bringToFront],
  );

  return { draggingId, startDrag };
}
