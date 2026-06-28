import { useState } from 'react';
import { useDashboardData } from './useDashboardData';
import { DashboardPage } from './DashboardPage';
import { WidgetGuide } from './guide/WidgetGuide';

/** Racine montée dans la fenêtre `dashboard` (voir main.tsx). */
export function DashboardRoot() {
  useDashboardData();
  const [showGuide, setShowGuide] = useState(false);

  if (showGuide) return <WidgetGuide onClose={() => setShowGuide(false)} />;
  return <DashboardPage onOpenGuide={() => setShowGuide(true)} />;
}
