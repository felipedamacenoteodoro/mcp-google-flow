import type { Page } from 'playwright-core';
import type { ResourceLibrary } from '../../application/ports.js';
import { NotFoundError, PreconditionFailedError } from '../../domain/errors.js';
import type { Resource, ResourceCategory } from '../../domain/library.js';
import { anyOf, exact, FlowPage, isOneOf, OVERLAY, stripIcon } from './flow-page.js';

/**
 * Flow's resource picker: opened by the composer's "+" button or by typing
 * "@". It lists images, videos, voices, characters, avatars and uploads, with
 * a search box and an "include in composer" action.
 */
export class FlowResourceLibrary implements ResourceLibrary {
  constructor(private readonly flow: FlowPage) {}

  async search(query: string, category: ResourceCategory): Promise<Resource[]> {
    const page = await this.openPicker({ allowFrameSlot: true });
    try {
      await this.selectTab(page, category);
      await this.typeSearch(page, query);
      return await this.options(page);
    } finally {
      await this.flow.dismissOverlays(page);
    }
  }

  async attach(name: string, category: ResourceCategory): Promise<Resource> {
    const page = await this.openPicker();
    return this.pickInOpenPicker(page, name, category);
  }

  /**
   * Selects `name` in a picker that is already open (also used by the frame
   * slots, which open the same picker with fewer tabs).
   */
  async pickInOpenPicker(page: Page, name: string, category: ResourceCategory | null): Promise<Resource> {
    try {
      if (category) await this.selectTab(page, category);
      await this.typeSearch(page, name);
      const options = await this.options(page);
      const index = bestMatch(options, name);
      if (index < 0) {
        throw new NotFoundError(`No resource named "${name}". Found: ${options.map((o) => o.name).join(', ') || 'nothing'}.`);
      }
      await page.locator(`${OVERLAY} [role=option]`).nth(index).click();
      await page.waitForTimeout(1_500);
      const include = page.locator(`${OVERLAY} button`, { hasText: anyOf(this.flow.labels.pickerInclude) }).first();
      if ((await include.count()) > 0 && (await include.isVisible())) {
        await include.click();
        await page.waitForTimeout(2_000);
      }
      return options[index]!;
    } finally {
      await this.flow.dismissOverlays(page);
    }
  }

  /**
   * Opens the picker from the prompt box's "+" button. In frames mode Flow
   * replaces "+" with start/end slots: searching can still go through the
   * start slot's picker, but attaching cannot (frames take start/end images).
   */
  private async openPicker(options: { allowFrameSlot?: boolean } = {}): Promise<Page> {
    const page = await this.flow.ensureOnGrid();
    const box = page.locator('flow-prompt-box');
    const plus = this.flow.byAria(box, this.flow.labels.addElements).first();
    if ((await plus.count()) > 0) {
      await plus.click();
    } else {
      const startSlot = box.locator('button', { hasText: exact(this.flow.labels.frameStart) }).first();
      if (!options.allowFrameSlot || (await startSlot.count()) === 0) {
        throw new PreconditionFailedError(
          'The prompt box is in frames mode, which takes a start and an end image instead of attachments. Use start_frame/end_frame, or switch to image or video mode.',
        );
      }
      await startSlot.click();
    }
    await page.waitForTimeout(1_500);
    return page;
  }

  private async selectTab(page: Page, category: ResourceCategory): Promise<void> {
    const label = this.flow.labels.pickerTabs[category];
    const tabs = page.locator(`${OVERLAY} [role=tab]`);
    const names = (await tabs.allInnerTexts()).map(stripIcon);
    const index = names.findIndex((name) => isOneOf(name, label));
    if (index < 0) return; // Frame pickers show only some tabs; stay on the default one.
    await tabs.nth(index).click();
    await page.waitForTimeout(1_200);
  }

  private async typeSearch(page: Page, query: string): Promise<void> {
    const box = this.flow.byAria(page.locator(OVERLAY), this.flow.labels.pickerSearch, 'input').first();
    if ((await box.count()) === 0) return;
    await box.fill(query);
    await page.waitForTimeout(1_500);
  }

  /** Options render the name and, on its own line, the kind ("ref06.png" / "Image"); the kind is not always shown. */
  private async options(page: Page): Promise<Resource[]> {
    const texts = await page.locator(`${OVERLAY} [role=option]`).allInnerTexts();
    return texts.map((text) => {
      const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
      return { name: lines[0] ?? '', kind: lines.length > 1 ? lines.at(-1)! : '' };
    });
  }
}

/** Exact name first, then case-insensitive, then prefix. */
function bestMatch(options: Resource[], name: string): number {
  const lower = name.toLowerCase();
  const exactIndex = options.findIndex((o) => o.name === name);
  if (exactIndex >= 0) return exactIndex;
  const insensitive = options.findIndex((o) => o.name.toLowerCase() === lower);
  if (insensitive >= 0) return insensitive;
  return options.findIndex((o) => o.name.toLowerCase().startsWith(lower));
}
