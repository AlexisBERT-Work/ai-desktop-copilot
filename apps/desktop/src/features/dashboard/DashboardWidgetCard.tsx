import { useState } from 'react';
import { GripVertical, Lock, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { Widget } from '@catdesk/shared-types';
import { useZoomStore } from '../../shared/hooks/useUiZoom';
import { useDashboardStore } from './dashboardStore';
import { widgetComponent } from './widgets/registry';
import { ACCENT_STYLES, BORDER_CLASS, RADIUS_CLASS, readWidgetStyle } from './widgets/widgetStyle';
import { WidgetErrorBoundary } from './widgets/WidgetErrorBoundary';
import { WidgetConfigEditor } from './widgets/WidgetConfigEditor';

interface Props {
  widget: Widget;
  /** Décalage de l'animation d'entrée (cascade au chargement du dashboard). */
  enterDelayMs?: number;
  editMode: boolean;
  /** Ce widget est en cours de drag (léger relief, il suit le curseur). */
  dragging: boolean;
  /** Appui pointeur sur la carte (hors contrôles) — démarre un éventuel drag. */
  onDragPointerDown: (e: React.PointerEvent<HTMLDivElement>, id: string) => void;
}

const ICON_BTN =
  'rounded p-1 text-white/30 transition-colors hover:bg-white/10 hover:text-white/70';

type ResizeAxis = 'x' | 'y' | 'both';

export function DashboardWidgetCard({
  widget,
  enterDelayMs = 0,
  editMode,
  dragging,
  onDragPointerDown,
}: Props) {
  const { removeWidget, renameWidget, setWidgetSize } = useDashboardStore();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(widget.title);
  const [editingConfig, setEditingConfig] = useState(false);
  /** Un redimensionnement à la poignée est en cours (badge de taille affiché). */
  const [resizing, setResizing] = useState(false);

  const Widget = widgetComponent(widget.type);
  const { accent, textScale, surface, opacity, hideHeader, border, radius, locked } =
    readWidgetStyle(widget);
  const accentStyle = ACCENT_STYLES[accent];

  // Une carte verrouillée reste configurable, mais ne bouge plus : ni drag ni
  // poignées. Évite de déplacer par mégarde une carte bien placée.
  const movable = editMode && !locked;

  /** Remplissage : 'auto' suit le fond global choisi dans Apparence. */
  const surfaceClass =
    surface === 'tinted' ? accentStyle.tint : surface === 'clear' ? 'bg-transparent' : '';
  const surfaceStyle =
    surface === 'auto' || surface === 'solid' ? { background: 'var(--card-bg)' } : {};

  const commitRename = () => {
    renameWidget(widget.id, draft.trim() || widget.title);
    setRenaming(false);
  };

  /**
   * Redimensionnement façon PowerPoint : on tire une poignée, la taille suit en
   * px exacts (snap léger et bornes appliqués par le store). Les deltas pointeur
   * sont en px viewport → divisés par le zoom UI pour retomber en px layout.
   */
  const beginResize = (e: React.PointerEvent, axis: ResizeAxis) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = widget.layout.w;
    const startH = widget.layout.h;

    const apply = (ev: PointerEvent) => {
      const zoom = useZoomStore.getState().zoom;
      const dw = axis === 'y' ? 0 : (ev.clientX - startX) / zoom;
      const dh = axis === 'x' ? 0 : (ev.clientY - startY) / zoom;
      setWidgetSize(widget.id, startW + dw, startH + dh);
    };
    const stop = () => {
      window.removeEventListener('pointermove', apply);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      setResizing(false);
    };
    setResizing(true);
    window.addEventListener('pointermove', apply);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  return (
    <div
      data-widget-id={widget.id}
      className={`group absolute flex animate-widget-enter flex-col transition-colors
        ${RADIUS_CLASS[radius]} ${BORDER_CLASS[border]} ${surfaceClass} ${
          dragging
            ? 'border-brand-400/70 shadow-2xl shadow-black/60'
            : resizing
              ? 'border-brand-400/60'
              : accentStyle.border
        } ${movable && !dragging && !resizing && border !== 'none' ? 'border-dashed' : ''}
        ${movable && !renaming && !editingConfig ? 'cursor-grab touch-none' : ''}`}
      style={{
        left: widget.layout.x,
        top: widget.layout.y,
        width: widget.layout.w,
        height: widget.layout.h,
        animationDelay: `${enterDelayMs}ms`,
        // Densité (Apparence) — l'espace intérieur de toutes les cartes.
        padding: 'var(--card-pad)',
        opacity,
        ...surfaceStyle,
      }}
      onPointerDown={e => {
        if (!movable || renaming || editingConfig || resizing) return;
        // Les contrôles (renommer, config, retirer…) restent cliquables.
        if ((e.target as HTMLElement).closest('button, input')) return;
        onDragPointerDown(e, widget.id);
      }}
    >
      {/* Header — masquable pour un rendu épuré, mais TOUJOURS rendu en mode
          édition : sinon la carte n'aurait plus ni renommage ni accès aux
          réglages, donc plus aucun moyen de rétablir l'en-tête. */}
      {(!hideHeader || editMode) && (
        <div className="flex items-center gap-1" style={{ marginBottom: 'var(--card-gap)' }}>
          {movable && (
            <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-white/25" aria-hidden />
          )}
          {locked && editMode && (
            <Lock className="h-3 w-3 shrink-0 text-white/30" aria-label="Carte verrouillée" />
          )}

          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  setDraft(widget.title);
                  setRenaming(false);
                }
              }}
              className="min-w-0 flex-1 rounded border border-white/15 bg-white/10 px-1.5 py-0.5
                       text-xs text-white/90 outline-none focus:border-brand-400/50"
              aria-label="Renommer le widget"
            />
          ) : (
            <button
              className={`min-w-0 flex-1 truncate text-left text-xs font-medium ${accentStyle.title}
              ${editMode ? 'cursor-text hover:text-white/90' : 'cursor-default'}`}
              onClick={() => editMode && setRenaming(true)}
              disabled={!editMode}
              title={editMode ? 'Cliquer pour renommer' : widget.title}
            >
              {widget.title}
            </button>
          )}

          {editMode && !renaming && (
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                className={`${ICON_BTN} ${editingConfig ? 'bg-white/10 text-white/80' : ''}`}
                onClick={() => setEditingConfig(v => !v)}
                aria-label="Configurer le widget"
                aria-pressed={editingConfig}
                title="Configurer"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
              <button
                className={`${ICON_BTN} hover:bg-red-500/15 hover:text-red-300`}
                onClick={() => removeWidget(widget.id)}
                aria-label="Retirer le widget"
                title="Retirer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Body — le contenu défile À L'INTÉRIEUR de la carte si elle est trop petite. */}
      {editingConfig ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <WidgetConfigEditor widget={widget} onClose={() => setEditingConfig(false)} />
        </div>
      ) : (
        <WidgetErrorBoundary>
          <div
            className={`min-h-0 flex-1 overflow-auto ${
              editMode ? 'pointer-events-none select-none opacity-90' : ''
            }`}
            // Taille du texte du widget : zoom local (met tout à l'échelle,
            // y compris les tailles rem de Tailwind).
            style={textScale !== 1 ? { zoom: textScale } : undefined}
          >
            <Widget widget={widget} />
          </div>
        </WidgetErrorBoundary>
      )}

      {/* Poignées de redimensionnement (mode édition) : bord droit, bord bas, coin. */}
      {movable && !editingConfig && (
        <>
          <div
            onPointerDown={e => beginResize(e, 'x')}
            className="absolute -right-1 bottom-6 top-6 w-2 cursor-ew-resize touch-none rounded
                       transition-colors hover:bg-brand-400/40"
            aria-hidden
          />
          <div
            onPointerDown={e => beginResize(e, 'y')}
            className="absolute -bottom-1 left-6 right-6 h-2 cursor-ns-resize touch-none rounded
                       transition-colors hover:bg-brand-400/40"
            aria-hidden
          />
          <div
            onPointerDown={e => beginResize(e, 'both')}
            className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize touch-none
                       rounded-sm border-2 border-brand-400/80 bg-gray-950 shadow
                       transition-transform hover:scale-125"
            title="Tirer pour redimensionner"
            aria-hidden
          />
        </>
      )}

      {/* Badge de taille pendant le redimensionnement (« 480 × 240 px »). */}
      {resizing && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-gray-950/50">
          <span className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-brand-300 shadow-lg">
            {widget.layout.w} × {widget.layout.h} px
          </span>
        </div>
      )}
    </div>
  );
}
