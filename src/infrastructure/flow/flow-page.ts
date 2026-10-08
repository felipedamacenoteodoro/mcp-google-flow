import { chmod } from 'node:fs/promises';
import { errors as playwrightErrors } from 'playwright-core';
import type { Download, Frame, Locator, Page } from 'playwright-core';
import type { Logger } from '../../application/ports.js';
import { FlowUnavailableError, PreconditionFailedError } from '../../domain/errors.js';
import type { PanelState, SubmitMode, SubmitResult } from '../../domain/generation.js';
import { FLOW_ORIGIN } from '../../domain/project-url.js';
import type { Prompt } from '../../domain/prompt.js';
import type { BrowserSession } from '../browser/browser-session.js';
import type { FlowUiLabels } from './ui-labels.js';

export const APP_SETTLE_MS = 9_000;
export const OVERLAY = '.cdk-overlay-container';
export const TILE = 'flow-grid-tile-container';
const PROJECT_ROOT = /^(https:\/\/flow\.google\.com\/project\/[0-9a-f-]{36})/;

/**
 * Shared plumbing for every Flow adapter: the one page, sign-in checks,
 * overlay menus, and turning selector timeouts into actionable errors.
 * User-supplied values reach the page only as `evaluate` arguments or typed
 * keystrokes, never as interpolated script source.
 */
export class FlowPage {
  constructor(
    private readonly session: BrowserSession,
    readonly labels: FlowUiLabels,
    readonly logger: Logger,
    readonly submitMode: SubmitMode = 'auto',
    /** Flow interface language to force (e.g. "en"); null keeps the Google account's language. */
    readonly language: string | null = null,
  ) {}

  /** The URL with Flow's interface language forced, when one is configured. */
  localized(url: string): string {
    if (!this.language) return url;
    const parsed = new URL(url);
    parsed.searchParams.set('hl', this.language);
    return parsed.href;
  }

  /** Navigates within Flow, keeping the configured interface language. */
  async open(page: Page, url: string): Promise<void> {
    await page.goto(this.localized(url), { waitUntil: 'domcontentloaded' });
  }

  /**
   * Presses a generate button, or in manual mode brings Flow to the front and
   * leaves that one click to the person, which is the action Flow's abuse
   * protection wants to come from a human.
   */
  async pressGenerate(button: Locator, element: string): Promise<SubmitResult> {
    const page = button.page();
    if (this.submitMode === 'manual') {
      await this.ui(element, () => button.waitFor({ state: 'visible', timeout: 15_000 }));
      await page.bringToFront();
      return 'handed-to-user';
    }
    await this.ui(element, () => button.click());
    await page.waitForTimeout(APP_SETTLE_MS);
    return 'clicked';
  }

  get connected(): boolean {
    return this.session.connected;
  }

  peekUrl(): string | null {
    return this.session.peekUrl();
  }

  openForSignIn(url: string): Promise<'own-chrome' | 'plain-window'> {
    return this.session.openForSignIn(this.localized(url));
  }

  page(): Promise<Page> {
    return this.session.currentPage();
  }

  /** The page, which must be inside a project the user is signed in to. */
  async projectPage(): Promise<Page> {
    const page = await this.page();
    this.requireSignedIn(page);
    if (!PROJECT_ROOT.test(page.url())) {
      throw new PreconditionFailedError('No Flow project is open. Call flow_new_project or flow_open_project first.');
    }
    return page;
  }

  /** `https://flow.google.com/project/<id>` of the open project. */
  async projectRoot(): Promise<string> {
    const page = await this.projectPage();
    return PROJECT_ROOT.exec(page.url())![1]!;
  }

  /**
   * Goes back to the project grid if a sub-page (scene, tool, characters) is
   * open. Every grid and composer action calls this first, so a previous call
   * that left the browser elsewhere cannot make the grid look empty.
   */
  async ensureOnGrid(): Promise<Page> {
    const page = await this.projectPage();
    const root = await this.projectRoot();
    if (page.url().split('?')[0] !== root) {
      await this.open(page, root);
      await page.waitForTimeout(APP_SETTLE_MS);
    }
    return page;
  }

  requireSignedIn(page: Page): void {
    if (!isSignedInUrl(page.url(), this.labels.signedOutPath)) {
      throw new FlowUnavailableError('Not signed in to Flow. Call flow_sign_in and log in in the Chrome window.');
    }
  }

  /** Elements whose aria-label is any of the label's alternatives ("A|B"). */
  byAria(scope: Page | Locator | Frame, label: string, tag = 'button'): Locator {
    // Each alternative is quoted as a CSS string so a label can never alter the selector.
    return scope.locator(alternatives(label).map((a) => `${tag}[aria-label=${JSON.stringify(a)}]`).join(', '));
  }

  menuItem(page: Page, text: string | RegExp): Locator {
    return page.locator(`${OVERLAY} [role=menuitem]`, { hasText: typeof text === 'string' ? anyOf(text) : text }).first();
  }

  /** Closes menus and popovers by clicking an empty corner (Escape leaves some triggers stuck). */
  async dismissOverlays(page: Page): Promise<void> {
    await page.mouse.click(5, 5);
    await page.waitForTimeout(700);
  }

  async openTileMenu(page: Page, index: number): Promise<boolean> {
    await this.dismissOverlays(page);
    const tile = page.locator(TILE).nth(index);
    await tile.hover();
    await page.waitForTimeout(1_200);
    try {
      await this.byAria(tile, this.labels.tileMenu).first().click({ timeout: 8_000 });
      await page.waitForTimeout(1_200);
      return true;
    } catch {
      return false;
    }
  }

  /** Types a prompt into an editor. Enter submits in Flow; line breaks need Shift+Enter. */
  async typeInto(editor: Locator, prompt: Prompt): Promise<void> {
    const page = editor.page();
    await this.ui('prompt editor', () => editor.click());
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    for (const [i, line] of prompt.lines.entries()) {
      if (i > 0) await page.keyboard.press('Shift+Enter');
      if (line.length > 0) await page.keyboard.type(line, { delay: 2 });
    }
    await page.waitForTimeout(1_000);
  }

  /** Flow's own price label ("A geração vai usar 12 créditos"), wherever it is rendered. */
  async readCreditCost(page: Page): Promise<number | null> {
    const texts = await page
      .locator('flow-credit-cost-label')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText));
    const pattern = new RegExp(this.labels.creditCost, 'i');
    for (const text of texts.reverse()) {
      const match = pattern.exec(text);
      if (match?.[1]) return Number(match[1]);
    }
    return null;
  }

  async panelState(page: Page, summarySource: Locator): Promise<PanelState> {
    const raw = await summarySource.innerText().catch(() => '');
    // Drop snake_case icon ligatures (arrow_forward, crop_9_16...) that Material renders as
    // words. Plain lowercase words stay: they may be part of the user's prompt.
    const summary = raw
      .split(/\s+/)
      .filter((word) => !/^[a-z]+(_[a-z0-9]+)+$/.test(word))
      .join(' ')
      .trim();
    return { summary, creditCost: await this.readCreditCost(page) };
  }

  /** Saves a download over the reserved file and restores owner-only permissions. */
  async saveDownload(download: Promise<Download>, destination: string): Promise<void> {
    await (await download).saveAs(destination);
    await chmod(destination, 0o600);
  }

  /** Runs a UI step, converting selector timeouts into an error the agent can act on. */
  async ui<T>(element: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof playwrightErrors.TimeoutError) {
        throw new FlowUnavailableError(
          `Flow UI element "${element}" was not found. The UI may have changed; adjust it via FLOW_MCP_UI_LABELS.`,
        );
      }
      throw error;
    }
  }
}

export function isSignedInUrl(url: string, signedOutPath: string): boolean {
  return url.startsWith(FLOW_ORIGIN) && !new URL(url).pathname.startsWith(signedOutPath);
}

/** The alternatives of a label: "Iniciar geração|Start generation" -> both strings. */
export function alternatives(label: string): string[] {
  return label.split('|').map((a) => a.trim()).filter(Boolean);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Matches text containing any alternative of the label. */
export function anyOf(label: string): RegExp {
  return new RegExp(alternatives(label).map(escapeRegex).join('|'));
}

/** Matches text that is exactly one of the label's alternatives. */
export function exact(label: string): RegExp {
  return new RegExp(`^\\s*(?:${alternatives(label).map(escapeRegex).join('|')})\\s*$`);
}

export function isOneOf(text: string, label: string): boolean {
  return alternatives(label).includes(text.trim());
}

/**
 * Visible text of a Material button without its icon ligature:
 * "videocam Vídeo" -> "Vídeo", "crop_9_16 9:16" -> "9:16", "360p info" -> "360p", "x1" -> "x1".
 */
export function stripIcon(text: string): string {
  const words = text.replace(/\s+/g, ' ').trim().replace(/ info$/, '').split(' ');
  return words.length > 1 && /^[a-z0-9_]+$/.test(words[0]!) ? words.slice(1).join(' ') : words.join(' ');
}
