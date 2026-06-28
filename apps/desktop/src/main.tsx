import React from 'react';
import ReactDOM from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App';
import { DashboardRoot } from './features/dashboard/DashboardRoot';
import './styles/globals.css';

// Deux fenêtres partagent ce bundle : la bulle IA ("main") et l'app Marchés &
// News ("dashboard"). On choisit la racine selon le label de la fenêtre.
let label = 'main';
try {
  label = getCurrentWindow().label;
} catch {
  /* hors Tauri (vite dev pur) — on retombe sur l'overlay */
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{label === 'dashboard' ? <DashboardRoot /> : <App />}</React.StrictMode>,
);
