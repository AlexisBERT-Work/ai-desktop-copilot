import { useState } from 'react';
import { X } from 'lucide-react';
import { useUiZoom } from '../../shared/hooks/useUiZoom';
import { useAppearance } from '../appearance/useAppearance';
import { AppearancePanel } from '../appearance/AppearancePanel';
import { useDashboardData } from './useDashboardData';
import { DashboardPage } from './DashboardPage';
import { WidgetGuide } from './guide/WidgetGuide';
import { DailiesAdminConsole } from '../dailies/DailiesAdminConsole';
import { MyFeedsPanel } from '../dailies/MyFeedsPanel';

type DashboardView = 'dashboard' | 'guide' | 'admin' | 'myfeeds';

/** Racine montée dans la fenêtre `dashboard` (voir main.tsx). */
export function DashboardRoot() {
  // Zoom de la fenêtre : Ctrl+molette, Ctrl+«+/−», Ctrl+0 (persisté).
  useUiZoom();
  // Accent, fond, densité, taille du texte — suit aussi les changements faits
  // depuis la fenêtre Réglages (bulle) sans rechargement.
  useAppearance('dashboard');
  useDashboardData();
  const [view, setView] = useState<DashboardView>('dashboard');
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  // NB : l'interception « fermer = masquer » de la fenêtre est posée dans
  // main.tsx, hors React — un crash du rendu ne doit pas la débrancher.

  if (view === 'guide') return <WidgetGuide onClose={() => setView('dashboard')} />;
  if (view === 'admin') return <DailiesAdminConsole onClose={() => setView('dashboard')} />;
  if (view === 'myfeeds') return <MyFeedsPanel onClose={() => setView('dashboard')} />;
  return (
    <>
      <DashboardPage
        onOpenGuide={() => setView('guide')}
        onOpenAdmin={() => setView('admin')}
        onOpenMyFeeds={() => setView('myfeeds')}
        onOpenAppearance={() => setAppearanceOpen(true)}
      />
      {appearanceOpen && <AppearanceDialog onClose={() => setAppearanceOpen(false)} />}
    </>
  );
}

/** Le panneau d'apparence en surimpression du tableau de bord (aperçu en direct
 *  derrière la boîte : on voit l'effet de chaque réglage sans fermer). */
function AppearanceDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10
                   bg-gray-950 p-4 shadow-2xl shadow-black/60"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Apparence"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/90">Apparence &amp; personnalisation</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <AppearancePanel />
      </div>
    </div>
  );
}
