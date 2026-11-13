import React from 'react';
import ReactDOM from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App';
import { DashboardRoot } from './features/dashboard/DashboardRoot';
import { DictationPill } from './features/voice/DictationPill';
import './styles/globals.css';

// Trois fenêtres partagent ce bundle : la bulle IA ("main"), l'app Marchés &
// News ("dashboard") et la pastille de dictée ("dictation-pill", créée par
// Rust quand la dictée est activée). On choisit la racine selon le label.
let label = 'main';
try {
  label = getCurrentWindow().label;
} catch {
  /* hors Tauri (vite dev pur) — on retombe sur l'overlay */
}

// La croix native de la fenêtre Marchés & News ne doit JAMAIS la détruire :
// détruite, getByLabel renvoie null et le bouton ne peut plus la rouvrir.
// Intercepté ICI, au chargement du module — hors du cycle de vie React — pour
// qu'un crash du rendu ou un rechargement à chaud ne débranche pas la garde
// (dans un useEffect, le cleanup la retirait ; il suffisait ensuite d'une croix
// pour perdre la fenêtre jusqu'au redémarrage).
if (label === 'dashboard') {
  const win = getCurrentWindow();
  void win.onCloseRequested(e => {
    e.preventDefault();
    void win.hide();
  });
}

function rootFor(windowLabel: string) {
  if (windowLabel === 'dashboard') return <DashboardRoot />;
  if (windowLabel === 'dictation-pill') return <DictationPill />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{rootFor(label)}</React.StrictMode>,
);
