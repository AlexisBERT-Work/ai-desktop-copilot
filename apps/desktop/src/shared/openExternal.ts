import { open } from '@tauri-apps/plugin-shell';

/**
 * Ouvre une URL dans le navigateur par défaut du système (jamais dans la fenêtre
 * de l'app, qui n'a pas de chrome de navigation). No-op pour une URL non http(s).
 */
export function openExternal(url: string | undefined): void {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    void open(url);
  }
}
