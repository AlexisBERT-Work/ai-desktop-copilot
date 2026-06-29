import { useState } from 'react';
import { useDashboardData } from './useDashboardData';
import { DashboardPage } from './DashboardPage';
import { WidgetGuide } from './guide/WidgetGuide';
import { DailiesAdminConsole } from '../dailies/DailiesAdminConsole';

type DashboardView = 'dashboard' | 'guide' | 'admin';

/** Racine montée dans la fenêtre `dashboard` (voir main.tsx). */
export function DashboardRoot() {
  useDashboardData();
  const [view, setView] = useState<DashboardView>('dashboard');

  if (view === 'guide') return <WidgetGuide onClose={() => setView('dashboard')} />;
  if (view === 'admin') return <DailiesAdminConsole onClose={() => setView('dashboard')} />;
  return (
    <DashboardPage onOpenGuide={() => setView('guide')} onOpenAdmin={() => setView('admin')} />
  );
}
