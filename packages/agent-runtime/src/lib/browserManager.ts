import { existsSync } from 'fs';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page, Route, WebSocketRoute } from 'playwright-core';
import { createLogger } from '../logger';

const log = createLogger('runtime:browser');

const BROWSER_PATHS_WINDOWS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

// Linux : pour le test d'intégration en CI (le poste cible est Windows).
const BROWSER_PATHS_LINUX = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
];

const MAX_SCREENSHOT_B64 = 3 * 1024 * 1024; // 3MB base64 limit

/** Navigateur installé sur le poste ; `CATDESK_BROWSER_PATH` (non vide) l'emporte. */
export function findSystemBrowser(): string | undefined {
  const forced = process.env['CATDESK_BROWSER_PATH']?.trim();
  if (forced !== undefined && forced.length > 0 && existsSync(forced)) return forced;
  const candidates = process.platform === 'win32' ? BROWSER_PATHS_WINDOWS : BROWSER_PATHS_LINUX;
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

// ─── Lecture seule ───────────────────────────────────────────────

/** Méthodes sans effet côté serveur (RFC 9110, « safe methods »). */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Écritures refusées gardées en mémoire (tampon circulaire). */
const MAX_BLOCKED = 50;
/** Temps laissé à la page, après un clic ou une saisie, pour émettre ce qu'ils déclenchent. */
const SETTLE_AFTER_ACTION_MS = 300;

/** Une écriture refusée par la lecture seule. */
export interface BlockedWrite {
  /** Méthode HTTP, ou `WEBSOCKET`. */
  method: string;
  url: string;
  /** Type Playwright : `document` (formulaire), `fetch`, `xhr`, `ping` (sendBeacon), `websocket`… */
  resourceType: string;
}

/** Toute méthode autre que GET, HEAD et OPTIONS est une écriture. Pur, exporté pour les tests. */
export function isWriteMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export class BrowserManager {
  private static _instance: BrowserManager | null = null;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private launching: Promise<Page> | null = null;

  /**
   * Lecture seule (défaut) : le navigateur lit, il n'écrit pas — toute requête
   * autre que GET/HEAD/OPTIONS et toute WebSocket sont refusées, un formulaire
   * ne part donc pas. Seule source de vérité : le moteur de permissions la lit
   * (risque de `browser_navigate` abaissé), le réglage de l'UI l'écrit.
   */
  private readOnly = true;
  private blocked: Array<BlockedWrite & { seq: number }> = [];
  private blockedSeq = 0;
  /** Même référence pour `route` et `unroute`. */
  private readonly guardRoute = (route: Route): Promise<void> => this.onRequest(route);

  static get(): BrowserManager {
    if (!BrowserManager._instance) {
      BrowserManager._instance = new BrowserManager();
    }
    return BrowserManager._instance;
  }

  private constructor() {}

  // ─── Lifecycle ─────────────────────────────────────────────────

  /**
   * Page prête à l'emploi, lancée au premier besoin. Deux défauts corrigés :
   * deux outils simultanés lançaient chacun leur navigateur (le lancement est
   * désormais partagé), et une page fermée relançait un navigateur sans fermer
   * l'ancien, qui restait orphelin jusqu'à la fin de l'agent.
   */
  private ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return Promise.resolve(this.page);
    this.launching ??= this.launch().finally(() => {
      this.launching = null;
    });
    return this.launching;
  }

  private async launch(): Promise<Page> {
    await this.close(); // navigateur précédent (page fermée, crash) : ne pas le laisser orphelin

    const executablePath = findSystemBrowser();
    log.info('Launching browser', { executablePath: executablePath ?? 'playwright-bundled' });

    this.browser = await chromium.launch({
      headless: true,
      ...(executablePath !== undefined ? { executablePath } : {}),
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      javaScriptEnabled: true,
      // Un service worker ferait ses requêtes hors de `context.route` : bloqués, toujours.
      serviceWorkers: 'block',
    });
    // WebSockets : route posée une fois, la lecture seule est lue à chaque connexion.
    await this.context.routeWebSocket(/.*/, ws => this.onWebSocket(ws));
    // HTTP : route posée seulement en lecture seule, car elle coupe le cache HTTP.
    if (this.readOnly) await this.context.route('**/*', this.guardRoute);

    this.page = await this.context.newPage();
    log.info('Browser ready', { readOnly: this.readOnly });
    return this.page;
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  /** Bascule la lecture seule ; s'applique tout de suite au navigateur ouvert. */
  async setReadOnly(on: boolean): Promise<void> {
    if (on === this.readOnly) return;
    this.readOnly = on;
    log.info('Browser read-only changed', { readOnly: on });
    const context = this.context;
    if (context === null) return; // appliqué au prochain lancement
    if (on) await context.route('**/*', this.guardRoute);
    else await context.unroute('**/*', this.guardRoute);
  }

  /** Repère à prendre avant une action, pour `blockedSince`. */
  blockedMark(): number {
    return this.blockedSeq;
  }

  /** Écritures refusées depuis `mark`. */
  blockedSince(mark: number): BlockedWrite[] {
    return this.blocked.filter(b => b.seq > mark).map(({ seq: _seq, ...write }) => write);
  }

  private recordBlocked(write: BlockedWrite): void {
    this.blockedSeq++;
    this.blocked.push({ ...write, seq: this.blockedSeq });
    if (this.blocked.length > MAX_BLOCKED) this.blocked.shift();
    log.info('Browser write blocked (read-only)', {
      method: write.method,
      resourceType: write.resourceType,
      url: write.url.slice(0, 200),
    });
  }

  private async onRequest(route: Route): Promise<void> {
    const request = route.request();
    try {
      // La route est retirée en sortie de lecture seule, mais une requête déjà
      // en vol peut encore arriver ici : l'état courant décide.
      if (!this.readOnly || !isWriteMethod(request.method())) {
        await route.continue();
        return;
      }
      this.recordBlocked({
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
      });
      await route.abort('blockedbyclient');
    } catch {
      // Page fermée pendant la requête : plus rien à décider.
    }
  }

  private onWebSocket(ws: WebSocketRoute): void {
    if (!this.readOnly) {
      ws.connectToServer(); // relais transparent dans les deux sens
      return;
    }
    this.recordBlocked({ method: 'WEBSOCKET', url: ws.url(), resourceType: 'websocket' });
    ws.close({ code: 1008, reason: 'CatDesk : navigateur en lecture seule' }).catch(() => {});
  }

  async close(): Promise<void> {
    if (this.browser === null) return;
    try {
      // Fermer le navigateur ferme aussi ses contextes et ses pages.
      await this.browser.close();
    } catch {
      // Non-fatal : déjà fermé ou planté.
    }
    this.page = null;
    this.context = null;
    this.browser = null;
    log.info('Browser closed');
  }

  // ─── Actions ───────────────────────────────────────────────────

  async navigate(
    url: string,
    opts: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeoutMs?: number } = {},
  ): Promise<{
    title: string;
    url: string;
    status: number | null;
    readOnly: boolean;
    blockedWrites: BlockedWrite[];
  }> {
    const page = await this.ensurePage();
    const mark = this.blockedMark();
    const response = await page.goto(url, {
      waitUntil: opts.waitUntil ?? 'domcontentloaded',
      timeout: opts.timeoutMs ?? 30_000,
    });
    const title = await page.title();
    return {
      title,
      url: page.url(),
      status: response?.status() ?? null,
      readOnly: this.readOnly,
      blockedWrites: this.blockedSince(mark),
    };
  }

  /**
   * Un formulaire part APRÈS le clic : on laisse à la page le temps de
   * l'émettre (et à la route de le refuser) avant de dire ce qui a été bloqué.
   */
  private async settle(page: Page, mark: number): Promise<BlockedWrite[]> {
    if (this.readOnly) await page.waitForTimeout(SETTLE_AFTER_ACTION_MS);
    return this.blockedSince(mark);
  }

  async screenshot(opts: { fullPage?: boolean; selector?: string } = {}): Promise<string> {
    const page = await this.ensurePage();

    let buf: Buffer;
    if (opts.selector) {
      const el = page.locator(opts.selector).first();
      buf = await el.screenshot({ type: 'png' });
    } else {
      buf = await page.screenshot({ type: 'png', fullPage: opts.fullPage ?? false });
    }

    const b64 = buf.toString('base64');
    if (b64.length > MAX_SCREENSHOT_B64) {
      throw new Error(
        `Screenshot trop grande (${Math.round(b64.length / 1024)}KB). Utilisez fullPage: false ou ciblez un élément.`,
      );
    }
    return b64;
  }

  async getText(opts: { selector?: string; maxChars?: number } = {}): Promise<string> {
    const page = await this.ensurePage();
    const max = opts.maxChars ?? 20_000;

    let text: string;
    if (opts.selector) {
      text = await page.locator(opts.selector).first().innerText({ timeout: 10_000 });
    } else {
      text = await page.locator('body').innerText({ timeout: 10_000 });
    }

    return text.trim().slice(0, max);
  }

  /** Rend les écritures que le clic a déclenchées et que la lecture seule a refusées. */
  async click(selector: string, timeoutMs = 10_000): Promise<BlockedWrite[]> {
    const page = await this.ensurePage();
    const mark = this.blockedMark();
    await page.locator(selector).first().click({ timeout: timeoutMs });
    return this.settle(page, mark);
  }

  /** Rend les écritures refusées pendant la saisie (enregistrement automatique d'un site). */
  async fill(
    selector: string,
    text: string,
    opts: { clearFirst?: boolean; timeoutMs?: number } = {},
  ): Promise<BlockedWrite[]> {
    const page = await this.ensurePage();
    const mark = this.blockedMark();
    const locator = page.locator(selector).first();

    if (opts.clearFirst !== false) {
      await locator.clear({ timeout: opts.timeoutMs ?? 10_000 });
    }
    await locator.fill(text, { timeout: opts.timeoutMs ?? 10_000 });
    return this.settle(page, mark);
  }

  getCurrentUrl(): string {
    return this.page?.url() ?? '';
  }

  isOpen(): boolean {
    return this.page !== null && !this.page.isClosed();
  }
}
