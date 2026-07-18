import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
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

  // Fermer via la croix native DÉTRUIRAIT la fenêtre → impossible à rouvrir
  // ensuite (getByLabel renvoie null). On intercepte pour seulement la masquer ;
  // le bouton la réaffiche alors à volonté.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(e => {
      e.preventDefault();
      void win.hide();
    });
    return () => {
      void unlisten.then(off => off());
    };
  }, []);

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
