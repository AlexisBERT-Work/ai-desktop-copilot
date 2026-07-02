import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

/**
 * Affiche/focus la fenêtre `dashboard` (application Marchés & News, séparée du
 * bot). La fenêtre est déclarée dans tauri.conf.json (visible: false au départ).
 */
export async function openDashboardWindow(): Promise<void> {
  const win = await WebviewWindow.getByLabel('dashboard');
  if (win === null) return;
  await win.show();
  try {
    await win.unminimize();
  } catch {
    /* fenêtre non minimisée — sans importance */
  }
  await win.setFocus();
}
