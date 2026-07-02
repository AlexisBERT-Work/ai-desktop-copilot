/**
 * Ouvre une URL dans le navigateur par défaut du système (jamais dans la fenêtre
 * de l'app, qui n'a pas de chrome de navigation). No-op pour une URL non http(s).
 *
 * Import dynamique volontaire : le plugin shell n'entre pas dans le graphe de
 * rendu des fenêtres (il n'est chargé qu'au moment du clic), donc un souci de
 * résolution/optimisation de ce module ne peut jamais bloquer l'affichage.
 */
export function openExternal(url: string | undefined): void {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
  void import('@tauri-apps/plugin-shell')
    .then(({ open }) => open(url))
    .catch((err) => {
      console.error('openExternal: échec ouverture du lien', err);
    });
}
