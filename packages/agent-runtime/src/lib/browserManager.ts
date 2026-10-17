import { existsSync } from 'fs';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { createLogger } from '../logger';

const log = createLogger('runtime:browser');

const BROWSER_PATHS_WINDOWS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const MAX_SCREENSHOT_B64 = 3 * 1024 * 1024; // 3MB base64 limit

function findSystemBrowser(): string | undefined {
  for (const p of BROWSER_PATHS_WINDOWS) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

export class BrowserManager {
  private static _instance: BrowserManager | null = null;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private launching: Promise<Page> | null = null;

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
    });

    this.page = await this.context.newPage();
    log.info('Browser ready');
    return this.page;
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
  ): Promise<{ title: string; url: string; status: number | null }> {
    const page = await this.ensurePage();
    const response = await page.goto(url, {
      waitUntil: opts.waitUntil ?? 'domcontentloaded',
      timeout: opts.timeoutMs ?? 30_000,
    });
    const title = await page.title();
    return {
      title,
      url: page.url(),
      status: response?.status() ?? null,
    };
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

  async click(selector: string, timeoutMs = 10_000): Promise<void> {
    const page = await this.ensurePage();
    await page.locator(selector).first().click({ timeout: timeoutMs });
  }

  async fill(
    selector: string,
    text: string,
    opts: { clearFirst?: boolean; timeoutMs?: number } = {},
  ): Promise<void> {
    const page = await this.ensurePage();
    const locator = page.locator(selector).first();

    if (opts.clearFirst !== false) {
      await locator.clear({ timeout: opts.timeoutMs ?? 10_000 });
    }
    await locator.fill(text, { timeout: opts.timeoutMs ?? 10_000 });
  }

  getCurrentUrl(): string {
    return this.page?.url() ?? '';
  }

  isOpen(): boolean {
    return this.page !== null && !this.page.isClosed();
  }
}
