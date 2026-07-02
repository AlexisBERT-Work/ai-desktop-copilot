import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useDashboardData } from './useDashboardData';
import { DashboardPage } from './DashboardPage';
import { WidgetGuide } from './guide/WidgetGuide';
import { DailiesAdminConsole } from '../dailies/DailiesAdminConsole';

type DashboardView = 'dashboard' | 'guide' | 'admin';

/** Racine montée dans la fenêtre `dashboard` (voir main.tsx). */
export function DashboardRoot() {
  useDashboardData();
  const [view, setView] = useState<DashboardView>('dashboard');

  // Fermer via la croix native DÉTRUIRAIT la fenêtre → impossible à rouvrir
  // ensuite (getByLabel renvoie null). On intercepte pour seulement la masquer ;
  // le bouton la réaffiche alors à volonté.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested((e) => {
      e.preventDefault();
      void win.hide();
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  if (view === 'guide') return <WidgetGuide onClose={() => setView('dashboard')} />;
  if (view === 'admin') return <DailiesAdminConsole onClose={() => setView('dashboard')} />;
  return (
    <DashboardPage onOpenGuide={() => setView('guide')} onOpenAdmin={() => setView('admin')} />
  );
}
