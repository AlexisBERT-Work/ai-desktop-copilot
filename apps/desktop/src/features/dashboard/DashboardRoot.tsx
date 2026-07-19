import { useState } from 'react';
import { useUiZoom } from '../../shared/hooks/useUiZoom';
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
  useDashboardData();
  const [view, setView] = useState<DashboardView>('dashboard');

  // NB : l'interception « fermer = masquer » de la fenêtre est posée dans
  // main.tsx, hors React — un crash du rendu ne doit pas la débrancher.

  if (view === 'guide') return <WidgetGuide onClose={() => setView('dashboard')} />;
  if (view === 'admin') return <DailiesAdminConsole onClose={() => setView('dashboard')} />;
  if (view === 'myfeeds') return <MyFeedsPanel onClose={() => setView('dashboard')} />;
  return (
    <DashboardPage
      onOpenGuide={() => setView('guide')}
      onOpenAdmin={() => setView('admin')}
      onOpenMyFeeds={() => setView('myfeeds')}
    />
  );
}
