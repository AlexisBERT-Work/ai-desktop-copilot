import { useDashboardData } from './useDashboardData';
import { DashboardPage } from './DashboardPage';

/** Racine montée dans la fenêtre `dashboard` (voir main.tsx). */
export function DashboardRoot() {
  useDashboardData();
  return <DashboardPage />;
}
