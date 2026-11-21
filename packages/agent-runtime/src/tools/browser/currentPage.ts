import { BrowserManager } from '../../lib/browserManager';

/**
 * URL de la page ouverte, pour l'accord « pour ce site » de `browser_click` et
 * `browser_type` : ils agissent sur la page courante, c'est elle que l'accord
 * vise. `undefined` sans page ouverte (l'outil échouera de toute façon).
 */
export function currentPageUrl(): string | undefined {
  const browser = BrowserManager.get();
  if (!browser.isOpen()) return undefined;
  const url = browser.getCurrentUrl();
  return url.length > 0 ? url : undefined;
}
