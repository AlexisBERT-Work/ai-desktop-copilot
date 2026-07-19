import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

/**
 * Affiche/focus la fenêtre `dashboard` (application Marchés & News, séparée du
 * bot). La fenêtre est déclarée dans tauri.conf.json (visible: false au départ)
 * et n'est jamais détruite en usage normal (fermer = masquer, garde posée dans
 * main.tsx). Si elle a QUAND MÊME disparu (crash de la webview, course au
 * chargement), on la recrée à l'identique au lieu de ne rien faire — le bouton
 * doit toujours aboutir à une fenêtre visible.
 */
export async function openDashboardWindow(): Promise<void> {
  const win = await WebviewWindow.getByLabel('dashboard');
  if (win !== null) {
    await win.show();
    try {
      await win.unminimize();
    } catch {
      /* fenêtre non minimisée — sans importance */
    }
    await win.setFocus();
    return;
  }

  // Fenêtre détruite : recréation avec les réglages de tauri.conf.json
  // (mêmes valeurs — les garder synchronisées). La garde « fermer = masquer »
  // se re-branche d'elle-même : main.tsx s'exécute dans la nouvelle webview.
  new WebviewWindow('dashboard', {
    title: 'CatDesk — Marchés & News',
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    resizable: true,
    decorations: true,
    visible: true,
    focus: true,
  });
}
