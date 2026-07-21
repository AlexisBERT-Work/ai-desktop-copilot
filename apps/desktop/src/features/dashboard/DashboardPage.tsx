import { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Bookmark, BookOpen, Check, Newspaper, Pencil, Plus, ShieldCheck, X } from 'lucide-react';
import { BrandMark } from '../../shared/components/BrandMark';
import { useDashboardStore } from './dashboardStore';
import { isNewsConfigured as isSupabaseConfigured } from '../news/supabaseClient';
import { PressRunStatusBanner } from '../dailies/PressRunStatusBanner';
import { DashboardWidgetCard } from './DashboardWidgetCard';
import { LayoutPresetsMenu } from './LayoutPresetsMenu';
import { useWidgetDrag } from './useWidgetDrag';
import { AddWidgetMenu } from './widgets/AddWidgetMenu';
import { computeActiveNews, useNewsStore } from '../news/newsStore';
import { NewsMarkdown } from '../news/NewsMarkdown';
import { NEWS_BANNER_STYLE, NEWS_ICON, NEWS_ICON_COLOR } from '../news/newsStyles';

/** Marge (px) laissée sous/à droite du contenu pour pouvoir y déposer un widget. */
const CANVAS_MARGIN = 240;

const hideWindow = () => {
  void getCurrentWindow().hide();
};

/**
 * Page pleine de l'application « Marchés & News » — fenêtre Tauri dédiée,
 * séparée de la bulle IA. Affiche les annonces + le canvas libre de widgets
 * (marchés, stats, formules…) : chaque widget est posé et dimensionné en px,
 * façon PowerPoint.
 */
interface DashboardPageProps {
  onOpenGuide: () => void;
  onOpenAdmin: () => void;
  /** « Mes journaux » — journaux personnalisés locaux, ouverts à tout utilisateur. */
  onOpenMyFeeds: () => void;
}

export function DashboardPage({ onOpenGuide, onOpenAdmin, onOpenMyFeeds }: DashboardPageProps) {
  const { config, editMode, setEditMode } = useDashboardStore();
  const [addOpen, setAddOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const { draggingId, startDrag } = useWidgetDrag(scrollRef, canvasRef);

  // Le canvas s'étend jusqu'au widget le plus bas/le plus à droite (+ marge).
  const canvasSize = useMemo(() => {
    let right = 0;
    let bottom = 0;
    for (const w of config.widgets) {
      right = Math.max(right, w.layout.x + w.layout.w);
      bottom = Math.max(bottom, w.layout.y + w.layout.h);
    }
    return { width: right + CANVAS_MARGIN, height: bottom + CANVAS_MARGIN };
  }, [config.widgets]);

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
    setPresetsOpen(false);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-950 text-white">
      {/* Header — teinté en mode édition pour rendre l'état impossible à confondre. */}
      <header
        className={`flex items-center gap-2.5 border-b px-5 py-3 transition-colors ${
          editMode ? 'border-brand-400/30 bg-brand-600/10' : 'border-white/10'
        }`}
      >
        <BrandMark subtitle="Marchés & News" />
        {editMode && (
          <span
            className="rounded-full border border-brand-400/40 bg-brand-600/25 px-2 py-0.5
                       text-[10px] font-semibold uppercase tracking-wider text-brand-200"
          >
            Mode édition
          </span>
        )}

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
            title="Journaux — tes revues de presse de ce poste, et les partagées (admin)"
          >
            <Newspaper className="h-3.5 w-3.5" />
            Journaux
          </button>

          {isSupabaseConfigured && (
            <button
              onClick={onOpenAdmin}
              className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-xs
                         text-white/70 transition-colors hover:bg-white/10 hover:text-white/90"
              title="Console admin — dailys manuelles et annonces (réservé à l'admin)"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Admin
            </button>
          )}

          {editMode && (
            <>
              <button
                onClick={() => {
                  setAddOpen(v => !v);
                  setPresetsOpen(false);
                }}
                className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-xs
                           text-white/70 transition-colors hover:bg-white/10 hover:text-white/90"
                aria-expanded={addOpen}
              >
                <Plus className="h-3.5 w-3.5" />
                Ajouter
              </button>
              <button
                onClick={() => {
                  setPresetsOpen(v => !v);
                  setAddOpen(false);
                }}
                className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${
                  presetsOpen
                    ? 'bg-white/10 text-white/90'
                    : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white/90'
                }`}
                aria-expanded={presetsOpen}
                title="Enregistrer et restaurer des affichages (plusieurs mises en page)"
              >
                <Bookmark className="h-3.5 w-3.5" />
                Affichages
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

      {editMode && presetsOpen && (
        <div className="border-b border-white/10 px-5 py-2">
          <LayoutPresetsMenu onClose={() => setPresetsOpen(false)} />
        </div>
      )}

      {/* Génération des dailys en cours/échouée — visible depuis l'accueil. */}
      <PressRunStatusBanner showDone={false} />

      {/* Corps scrollable (2 axes) : News + canvas libre */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
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
              ref={canvasRef}
              className="relative"
              style={{
                width: canvasSize.width,
                height: canvasSize.height,
                // Pointillés discrets en mode édition : repère visuel du canvas.
                ...(editMode
                  ? {
                      backgroundImage:
                        'radial-gradient(circle, rgb(255 255 255 / 0.08) 1px, transparent 1px)',
                      backgroundSize: '24px 24px',
                    }
                  : {}),
              }}
            >
              {config.widgets.map((w, i) => (
                <DashboardWidgetCard
                  key={w.id}
                  widget={w}
                  enterDelayMs={Math.min(i, 12) * 45}
                  editMode={editMode}
                  dragging={draggingId === w.id}
                  onDragPointerDown={startDrag}
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
  const items = useNewsStore(s => s.items);
  const dismissedIds = useNewsStore(s => s.dismissedIds);
  const dismiss = useNewsStore(s => s.dismiss);
  const status = useNewsStore(s => s.status);
  const active = useMemo(() => computeActiveNews(items, dismissedIds), [items, dismissedIds]);

  if (status === 'unconfigured' || active.length === 0) return null;

  return (
    <div className="space-y-2 border-b border-white/10 px-5 py-3">
      {active.slice(0, 4).map(n => {
        const Icon = NEWS_ICON[n.severity];
        return (
          <div
            key={n.id}
            className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${NEWS_BANNER_STYLE[n.severity]}`}
          >
            <Icon
              className={`mt-0.5 h-5 w-5 shrink-0 ${NEWS_ICON_COLOR[n.severity]}`}
              aria-hidden
            />
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
