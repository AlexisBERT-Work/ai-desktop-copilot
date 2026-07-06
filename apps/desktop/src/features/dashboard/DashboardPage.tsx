import { useEffect, useMemo, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  BookOpen,
  Check,
  Newspaper,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { BrandMark } from '../../shared/components/BrandMark';
import { useDashboardStore } from './dashboardStore';
import { isNewsConfigured as isSupabaseConfigured } from '../news/supabaseClient';
import { DashboardWidgetCard } from './DashboardWidgetCard';
import { AddWidgetMenu } from './widgets/AddWidgetMenu';
import { computeActiveNews, useNewsStore } from '../news/newsStore';
import { NewsMarkdown } from '../news/NewsMarkdown';
import { NEWS_BANNER_STYLE, NEWS_ICON, NEWS_ICON_COLOR } from '../news/newsStyles';

const COLS = 4;

const hideWindow = () => {
  void getCurrentWindow().hide();
};

/**
 * Page pleine de l'application « Marchés & News » — fenêtre Tauri dédiée,
 * séparée de la bulle IA. Affiche les annonces + la grille de widgets (marchés,
 * stats, formules…).
 */
interface DashboardPageProps {
  onOpenGuide: () => void;
  onOpenAdmin: () => void;
  /** « Mes journaux » — journaux personnalisés locaux, ouverts à tout utilisateur. */
  onOpenMyFeeds: () => void;
}

export function DashboardPage({ onOpenGuide, onOpenAdmin, onOpenMyFeeds }: DashboardPageProps) {
  const { config, editMode, setEditMode, reorderWidget, resetToDefault } = useDashboardStore();
  const [addOpen, setAddOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Échap : ferme l'éditeur s'il est ouvert, sinon masque la fenêtre.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editMode) setEditMode(false);
      else hideWindow();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editMode, setEditMode]);

  const exitEdit = () => {
    setEditMode(false);
    setAddOpen(false);
    setConfirmReset(false);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center gap-2.5 border-b border-white/10 px-5 py-3">
        <BrandMark subtitle="Marchés & News" />

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={onOpenGuide}
            className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-xs
                       text-white/70 transition-colors hover:bg-white/10 hover:text-white/90"
            title="Guide des widgets (exportable en PDF)"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Guide
          </button>

          <button
            onClick={onOpenMyFeeds}
            className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-xs
                       text-white/70 transition-colors hover:bg-white/10 hover:text-white/90"
            title="Mes journaux — tes propres revues de presse, générées sur ce poste"
          >
            <Newspaper className="h-3.5 w-3.5" />
            Mes journaux
          </button>

          {isSupabaseConfigured && (
            <button
              onClick={onOpenAdmin}
              className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-xs
                         text-white/70 transition-colors hover:bg-white/10 hover:text-white/90"
              title="Console admin — rédiger les dailys (réservé à l'admin)"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Admin
            </button>
          )}

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
                className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${
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
            className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${
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
            onClick={hideWindow}
            className="rounded-lg p-1 text-white/30 transition-colors hover:bg-white/5 hover:text-white/60"
            aria-label="Fermer"
            title="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {editMode && addOpen && (
        <div className="border-b border-white/10 px-5 py-2">
          <AddWidgetMenu onClose={() => setAddOpen(false)} />
        </div>
      )}

      {/* Corps scrollable : News + grille */}
      <div className="flex-1 overflow-y-auto">
        <NewsSection />

        <div className="p-5">
          {config.widgets.length === 0 ? (
            <div className="py-16 text-center text-sm text-white/30">
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
                gridAutoRows: 'minmax(88px, auto)',
              }}
            >
              {config.widgets.map((w, i) => (
                <DashboardWidgetCard
                  key={w.id}
                  widget={w}
                  enterDelayMs={Math.min(i, 12) * 45}
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
      </div>
    </div>
  );
}

/** Bandeau d'annonces (news admin) en tête de page. */
function NewsSection() {
  const items = useNewsStore((s) => s.items);
  const dismissedIds = useNewsStore((s) => s.dismissedIds);
  const dismiss = useNewsStore((s) => s.dismiss);
  const status = useNewsStore((s) => s.status);
  const active = useMemo(() => computeActiveNews(items, dismissedIds), [items, dismissedIds]);

  if (status === 'unconfigured' || active.length === 0) return null;

  return (
    <div className="space-y-2 border-b border-white/10 px-5 py-3">
      {active.slice(0, 4).map((n) => {
        const Icon = NEWS_ICON[n.severity];
        return (
        <div
          key={n.id}
          className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${NEWS_BANNER_STYLE[n.severity]}`}
        >
          <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${NEWS_ICON_COLOR[n.severity]}`} aria-hidden />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-white/90">{n.title}</p>
            <div className="text-white/70">
              <NewsMarkdown content={n.body} />
            </div>
          </div>
          <button
            onClick={() => dismiss(n.id)}
            className="rounded-md p-1 text-white/40 transition hover:bg-white/10 hover:text-white/80"
            aria-label="Ignorer cette annonce"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        );
      })}
    </div>
  );
}
