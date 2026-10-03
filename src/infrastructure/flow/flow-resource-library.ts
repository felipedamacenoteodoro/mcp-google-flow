import type { Page } from 'playwright-core';
import type { ResourceLibrary } from '../../application/ports.js';
import { NotFoundError } from '../../domain/errors.js';
import type { Resource, ResourceCategory } from '../../domain/library.js';
import { FlowPage, OVERLAY, stripIcon } from './flow-page.js';

/**
 * Flow's resource picker: opened by the composer's "+" button or by typing
 * "@". It lists images, videos, voices, characters, avatars and uploads, with
 * a search box and an "include in composer" action.
 */
export class FlowResourceLibrary implements ResourceLibrary {
  constructor(private readonly flow: FlowPage) {}

  async search(query: string, category: ResourceCategory): Promise<Resource[]> {
    const page = await this.openPicker();
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
      const include = page.locator(`${OVERLAY} button`, { hasText: this.flow.labels.pickerInclude }).first();
      if ((await include.count()) > 0 && (await include.isVisible())) {
        await include.click();
        await page.waitForTimeout(2_000);
      }
      return options[index]!;
    } finally {
      await this.flow.dismissOverlays(page);
    }
  }

  private async openPicker(): Promise<Page> {
    const page = await this.flow.ensureOnGrid();
    await this.flow.ui('add elements', () =>
      this.flow.byAria(page.locator('flow-prompt-box'), this.flow.labels.addElements).first().click(),
    );
    await page.waitForTimeout(1_500);
    return page;
  }

  private async selectTab(page: Page, category: ResourceCategory): Promise<void> {
    const label = this.flow.labels.pickerTabs[category];
    const tabs = page.locator(`${OVERLAY} [role=tab]`);
    const names = (await tabs.allInnerTexts()).map(stripIcon);
    const index = names.indexOf(label);
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

  /** Options read as "name Kind", e.g. "ref06.png Imagem". */
  private async options(page: Page): Promise<Resource[]> {
    const texts = await page.locator(`${OVERLAY} [role=option]`).allInnerTexts();
    return texts.map((text) => {
      const words = text.replace(/\s+/g, ' ').trim().split(' ');
      const kind = words.length > 1 ? words.pop()! : '';
      return { name: words.join(' '), kind };
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
