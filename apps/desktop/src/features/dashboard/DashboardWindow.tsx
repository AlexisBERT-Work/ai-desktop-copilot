import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, LayoutDashboard, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { useOverlayStore } from '../overlay/overlayStore';
import { useDashboardStore } from './dashboardStore';
import { DashboardWidgetCard } from './DashboardWidgetCard';
import { AddWidgetMenu } from './widgets/AddWidgetMenu';

const COLS = 3;

/**
 * Interface configurable (Pilier A) : une grille de widgets pilotée par
 * `DashboardConfig`. Mode édition pour ajouter / réorganiser (drag) /
 * redimensionner / renommer / configurer / retirer les widgets.
 */
export function DashboardWindow() {
  const { setMode } = useOverlayStore();
  const { config, editMode, setEditMode, reorderWidget, resetToDefault } = useDashboardStore();

  const [addOpen, setAddOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Échap : referme l'éditeur s'il est ouvert, sinon revient au mini-mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editMode) setEditMode(false);
      else setMode('mini');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editMode, setEditMode, setMode]);

  const exitEdit = () => {
    setEditMode(false);
    setAddOpen(false);
    setConfirmReset(false);
  };

  return (
    <motion.div
      className="flex max-h-[80vh] w-[860px] flex-col overflow-hidden rounded-2xl
                 border border-white/10 bg-gray-950/97 shadow-2xl shadow-black/60
                 backdrop-blur-2xl ring-1 ring-white/5"
      layoutId="overlay-shell"
      role="dialog"
      aria-label="Tableau de bord"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-white/5 px-4 py-3">
        <LayoutDashboard className="h-4 w-4 text-brand-400" />
        <span className="text-sm font-medium tracking-[-0.01em] text-white/90">
          Tableau de bord
        </span>

        <div className="ml-auto flex items-center gap-1">
          {editMode && (
            <>
              <button
                onClick={() => setAddOpen((v) => !v)}
                className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-xs
                           text-white/70 transition-colors hover:bg-white/10 hover:text-white/90"
                aria-expanded={addOpen}
              >
                <Plus className="h-3.5 w-3.5" />
                Ajouter
              </button>
              <button
                onClick={() => {
                  if (confirmReset) {
                    resetToDefault();
                    setConfirmReset(false);
                  } else {
                    setConfirmReset(true);
                  }
                }}
                onBlur={() => setConfirmReset(false)}
                className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors
                  ${
                    confirmReset
                      ? 'bg-red-500/20 text-red-200 hover:bg-red-500/30'
                      : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white/90'
                  }`}
                title="Rétablir la disposition par défaut"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {confirmReset ? 'Confirmer ?' : 'Réinitialiser'}
              </button>
            </>
          )}

          <button
            onClick={() => (editMode ? exitEdit() : setEditMode(true))}
            className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors
              ${
                editMode
                  ? 'bg-brand-600 text-white hover:bg-brand-500'
                  : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white/90'
              }`}
            aria-pressed={editMode}
          >
            {editMode ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            {editMode ? 'Terminé' : 'Éditer'}
          </button>

          <button
            onClick={() => setMode('mini')}
            className="rounded-lg p-1 text-white/30 transition-colors hover:bg-white/5 hover:text-white/60"
            aria-label="Fermer"
            title="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Menu d'ajout */}
      {editMode && addOpen && (
        <div className="border-b border-white/5 px-3 py-2">
          <AddWidgetMenu onClose={() => setAddOpen(false)} />
        </div>
      )}

      {/* Grille */}
      <div className="overflow-y-auto p-3">
        {config.widgets.length === 0 ? (
          <div className="py-12 text-center text-sm text-white/30">
            {editMode ? (
              <button
                onClick={() => setAddOpen(true)}
                className="rounded-lg bg-white/5 px-3 py-2 text-white/60 hover:bg-white/10 hover:text-white/90"
              >
                + Ajouter un premier widget
              </button>
            ) : (
              <>Aucun widget. Clique sur « Éditer » pour en ajouter.</>
            )}
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
              gridAutoRows: 'minmax(80px, auto)',
            }}
          >
            {config.widgets.map((w) => (
              <DashboardWidgetCard
                key={w.id}
                widget={w}
                editMode={editMode}
                dragging={draggingId === w.id}
                onDragStart={setDraggingId}
                onDragEnd={() => setDraggingId(null)}
                onDropOn={(targetId) => {
                  if (draggingId) reorderWidget(draggingId, targetId);
                  setDraggingId(null);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
