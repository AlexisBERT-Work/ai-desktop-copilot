import { useRef, useState } from 'react';
import { ArrowLeftRight, ArrowUpDown, GripVertical, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { Widget } from '@catdesk/shared-types';
import { MAX_H, MAX_W } from './dashboardStore';
import { useDashboardStore } from './dashboardStore';
import { widgetComponent } from './widgets/registry';
import { WidgetErrorBoundary } from './widgets/WidgetErrorBoundary';
import { WidgetConfigEditor } from './widgets/WidgetConfigEditor';

interface Props {
  widget: Widget;
  /** Décalage de l'animation d'entrée (cascade au chargement du dashboard). */
  enterDelayMs?: number;
  editMode: boolean;
  dragging: boolean;
  onDragStart: (id: string) => void;
  onDropOn: (targetId: string) => void;
  onDragEnd: () => void;
}

const ICON_BTN =
  'rounded p-1 text-white/30 transition-colors hover:bg-white/10 hover:text-white/70';

/** Espacement de la grille du dashboard (gap-3 dans DashboardPage). */
const GRID_GAP = 12;

type ResizeAxis = 'x' | 'y' | 'both';

export function DashboardWidgetCard({
  widget,
  enterDelayMs = 0,
  editMode,
  dragging,
  onDragStart,
  onDropOn,
  onDragEnd,
}: Props) {
  const { removeWidget, renameWidget, cycleWidgetWidth, cycleWidgetHeight, setWidgetSize } =
    useDashboardStore();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(widget.title);
  const [editingConfig, setEditingConfig] = useState(false);
  const [over, setOver] = useState(false);
  /** Taille (unités de grille) pendant un redimensionnement à la poignée. */
  const [resizing, setResizing] = useState<{ w: number; h: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const Widget = widgetComponent(widget.type);

  const commitRename = () => {
    renameWidget(widget.id, draft.trim() || widget.title);
    setRenaming(false);
  };

  /**
   * Redimensionnement façon PowerPoint : on tire une poignée, la taille snappe
   * sur la grille en direct. La taille d'une unité est mesurée au départ sur
   * la carte elle-même (robuste au zoom UI et à la largeur de fenêtre).
   */
  const beginResize = (e: React.PointerEvent, axis: ResizeAxis) => {
    e.preventDefault();
    e.stopPropagation();
    const el = cardRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = Math.min(Math.max(widget.layout.w, 1), MAX_W);
    const startH = Math.max(widget.layout.h, 1);
    const unitW = (rect.width - GRID_GAP * (startW - 1)) / startW;
    const unitH = (rect.height - GRID_GAP * (startH - 1)) / startH;

    const apply = (ev: PointerEvent) => {
      const dw = axis === 'y' ? 0 : Math.round((ev.clientX - startX) / (unitW + GRID_GAP));
      const dh = axis === 'x' ? 0 : Math.round((ev.clientY - startY) / (unitH + GRID_GAP));
      const w = Math.min(Math.max(startW + dw, 1), MAX_W);
      const h = Math.min(Math.max(startH + dh, 1), MAX_H);
      setResizing({ w, h });
      setWidgetSize(widget.id, w, h);
    };
    const stop = () => {
      window.removeEventListener('pointermove', apply);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      setResizing(null);
    };
    setResizing({ w: startW, h: startH });
    window.addEventListener('pointermove', apply);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  return (
    <div
      ref={cardRef}
      className={`group relative flex animate-widget-enter flex-col rounded-xl border bg-white/5 p-3
        transition-colors ${over ? 'border-brand-400/60' : 'border-white/10'}
        ${dragging ? 'opacity-40' : ''} ${resizing !== null ? 'border-brand-400/60' : ''}`}
      style={{
        gridColumn: `span ${Math.min(widget.layout.w, MAX_W)}`,
        gridRow: `span ${Math.max(widget.layout.h, 1)}`,
        animationDelay: `${enterDelayMs}ms`,
      }}
      draggable={editMode && !renaming && !editingConfig && resizing === null}
      onDragStart={() => onDragStart(widget.id)}
      onDragEnd={() => {
        setOver(false);
        onDragEnd();
      }}
      onDragOver={e => {
        if (editMode) e.preventDefault();
      }}
      onDragEnter={() => editMode && setOver(true)}
      onDragLeave={() => setOver(false)}
      onDrop={() => {
        setOver(false);
        onDropOn(widget.id);
      }}
    >
      {/* Header */}
      <div className="mb-2 flex items-center gap-1">
        {editMode && (
          <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-white/25" aria-hidden />
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
            className={`min-w-0 flex-1 truncate text-left text-xs font-medium text-white/60
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
              className={ICON_BTN}
              onClick={() => cycleWidgetWidth(widget.id)}
              aria-label="Changer la largeur"
              title={`Largeur : ${widget.layout.w}/${MAX_W}`}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </button>
            <button
              className={ICON_BTN}
              onClick={() => cycleWidgetHeight(widget.id)}
              aria-label="Changer la hauteur"
              title={`Hauteur : ${widget.layout.h}/${MAX_H}`}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
            </button>
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

      {/* Body */}
      {editingConfig ? (
        <WidgetConfigEditor widget={widget} onClose={() => setEditingConfig(false)} />
      ) : (
        <WidgetErrorBoundary>
          <div className={editMode ? 'pointer-events-none select-none opacity-90' : ''}>
            <Widget widget={widget} />
          </div>
        </WidgetErrorBoundary>
      )}

      {/* Poignées de redimensionnement (mode édition) : bord droit, bord bas, coin. */}
      {editMode && !editingConfig && (
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
          {/* L'accès clavier reste assuré par les boutons largeur/hauteur du header. */}
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

      {/* Badge de taille pendant le redimensionnement (« 2 × 1 »). */}
      {resizing !== null && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-gray-950/50">
          <span className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-brand-300 shadow-lg">
            {resizing.w} × {resizing.h}
          </span>
        </div>
      )}
    </div>
  );
}
