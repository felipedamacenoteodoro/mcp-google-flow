import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import type { Logger } from '../../application/ports.js';
import { FlowUnavailableError } from '../../domain/errors.js';
import type { ChromeLauncher } from './chrome-launcher.js';
import { loopbackEndpoint } from './cdp-endpoint.js';

/**
 * Owns the CDP connection and exactly one page. Other tabs in the same Chrome
 * are never read, reused or closed.
 */
export class BrowserSession {
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor(
    private readonly launcher: ChromeLauncher,
    private readonly logger: Logger,
    private readonly fixedEndpoint?: string,
  ) {}

  get connected(): boolean {
    return this.browser?.isConnected() ?? false;
  }

  async currentPage(): Promise<Page> {
    const browser = await this.ensureBrowser();
    if (this.page && !this.page.isClosed()) return this.page;

    const context = browser.contexts()[0];
    if (!context) throw new FlowUnavailableError('Chrome has no default browser context.');
    this.page = await context.newPage();
    return this.page;
  }

  /** Closes the page this server opened and disconnects, leaving Chrome and its other tabs alone. */
  async dispose(): Promise<void> {
    if (this.page && !this.page.isClosed()) await this.page.close().catch(() => undefined);
    // For a CDP connection, close() only disconnects; it does not quit Chrome.
    if (this.browser?.isConnected()) await this.browser.close().catch(() => undefined);
    this.page = null;
    this.browser = null;
  }

  /**
   * Gets Chrome ready for the user to sign in. With a user-supplied Chrome
   * (FLOW_MCP_CDP_URL) it just opens the page there. With the dedicated
   * profile it closes the automated Chrome and reopens the profile as a plain
   * window, because Google blocks sign-in in automated browsers.
   */
  async openForSignIn(url: string): Promise<'own-chrome' | 'plain-window'> {
    if (this.fixedEndpoint) {
      const page = await this.currentPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.bringToFront();
      return 'own-chrome';
    }
    await this.closeDedicatedChrome();
    await this.launcher.launchForSignIn(url);
    return 'plain-window';
  }

  /** Quits the automated Chrome running on the dedicated profile, if any. */
  private async closeDedicatedChrome(): Promise<void> {
    const endpoint = await this.launcher.runningEndpoint();
    if (!endpoint || !(await isAlive(endpoint))) return;
    const browser = this.browser?.isConnected() ? this.browser : await chromium.connectOverCDP(endpoint, { timeout: 15_000 });
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send('Browser.close').catch(() => undefined);
    this.browser = null;
    this.page = null;
    for (let i = 0; i < 40 && (await isAlive(endpoint)); i++) await new Promise((r) => setTimeout(r, 250));
  }

  /** Current URL without connecting or launching anything. */
  peekUrl(): string | null {
    return this.page && !this.page.isClosed() ? this.page.url() : null;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;

    const endpoint = this.fixedEndpoint
      ? loopbackEndpoint(this.fixedEndpoint)
      : await this.connectableEndpoint();

    this.browser = await connectWithWindow(endpoint);
    this.browser.on('disconnected', () => {
      this.browser = null;
      this.page = null;
      this.logger.warn('browser disconnected');
    });
    return this.browser;
  }

  private async connectableEndpoint(): Promise<string> {
    const existing = await this.launcher.runningEndpoint();
    if (existing && (await isAlive(existing))) return existing;
    this.logger.info('launching Chrome on the dedicated profile');
    return this.launcher.launch();
  }
}

async function isAlive(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * On macOS Chrome keeps running after its last window closes, and Playwright
 * cannot attach to a Chrome with no window. When that happens, open a blank
 * tab through the DevTools HTTP endpoint and attach again.
 */
async function connectWithWindow(endpoint: string): Promise<Browser> {
  try {
    return await chromium.connectOverCDP(endpoint, { timeout: 15_000 });
  } catch (error) {
    if (!String(error).includes('Browser context management is not supported')) throw error;
    await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT', signal: AbortSignal.timeout(5_000) });
    return chromium.connectOverCDP(endpoint, { timeout: 15_000 });
  }
}
