import type { Page } from 'playwright-core';
import type { SceneEditor } from '../../application/ports.js';
import { NotFoundError, PreconditionFailedError } from '../../domain/errors.js';
import type { PanelState } from '../../domain/generation.js';
import type { Prompt } from '../../domain/prompt.js';
import type { ExtendAvailability, SceneAction, SceneSummary } from '../../domain/scene.js';
import { APP_SETTLE_MS, FlowPage, OVERLAY, TILE } from './flow-page.js';

const SCENE_URL = /\/scene\/[0-9a-f-]{36}/;
const RAIL_NAVIGATION = /^(Mídia anterior|Próxima mídia|Previous media|Next media)$/;

/**
 * The scene builder (`/project/<id>/scene/<id>`): a timeline of clips with an
 * "add clip" menu holding the Extend action, a prompt box that edits the
 * selected clip, and an export of the whole scene.
 *
 * The extend menu entry and its disabled reason were verified on 2026-09-29.
 * The form that follows the Extend click could not be observed (it needs a
 * Veo-generated clip) and is driven through the scene's visible prompt box.
 */
export class FlowSceneEditor implements SceneEditor {
  constructor(private readonly flow: FlowPage) {}

  async open(index: number): Promise<SceneSummary> {
    const page = await this.flow.projectPage();
    const tile = page.locator(TILE).nth(index).locator('flow-scene-tile');
    if ((await tile.count()) === 0) throw new NotFoundError(`Tile ${index} is not a scene.`);
    await tile.click();
    await page.waitForURL(SCENE_URL, { timeout: 30_000 });
    await page.waitForTimeout(APP_SETTLE_MS);

    const items = await page
      .locator('flow-navigation-rail button[aria-label]')
      .evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label') ?? ''));
    return { url: page.url(), clips: items.filter((label) => label && !RAIL_NAVIGATION.test(label)) };
  }

  async extendAvailability(): Promise<ExtendAvailability> {
    const page = await this.scenePage();
    await this.openAddClipMenu(page);
    try {
      const item = page.locator(`${OVERLAY} [role=menuitem]`, { hasText: this.flow.labels.extendItem }).first();
      if ((await item.count()) === 0) return { available: false, model: null, reason: 'Flow shows no extend option.' };
      const text = (await item.innerText()).replace(/\s+/g, ' ');
      const model = /\(([^)]+)\)/.exec(text)?.[1] ?? null;
      const disabled = (await item.getAttribute('disabled')) !== null || (await item.getAttribute('aria-disabled')) === 'true';
      const tooltipId = await item.getAttribute('aria-describedby');
      const reason = disabled && tooltipId
        ? await page.evaluate((id) => document.getElementById(id)?.textContent?.trim() ?? null, tooltipId)
        : null;
      return { available: !disabled, model, reason: disabled ? (reason ?? 'disabled by Flow') : null };
    } finally {
      await this.flow.dismissOverlays(page);
    }
  }

  async prepare(action: SceneAction, prompt: Prompt): Promise<PanelState> {
    const page = await this.scenePage();
    if (action === 'extend') {
      await this.openAddClipMenu(page);
      await this.flow.ui('extend', () =>
        page.locator(`${OVERLAY} [role=menuitem]`, { hasText: this.flow.labels.extendItem }).first().click(),
      );
      await page.waitForTimeout(3_000);
    }
    await this.flow.typeInto(this.activeEditor(page, action), prompt);
    return this.flow.panelState(page, this.activeBox(page, action));
  }

  async submit(): Promise<void> {
    const page = await this.scenePage();
    const button = page.locator('flow-base-prompt-box').last().locator(`button[aria-label=${JSON.stringify(this.flow.labels.submit)}]`);
    await this.flow.ui('scene submit', () => button.first().click());
    await page.waitForTimeout(APP_SETTLE_MS);
  }

  async download(destination: string): Promise<void> {
    const page = await this.scenePage();
    const download = page.waitForEvent('download', { timeout: 300_000 });
    await this.flow.ui('download scene', () => this.flow.byAria(page, this.flow.labels.downloadScene).first().click());
    await page.waitForTimeout(2_000);
    // If Flow asks for a resolution, take the free one.
    const standard = page.locator(`${OVERLAY} [role=menuitem]`, { hasText: new RegExp(this.flow.labels.quality.standard) });
    if ((await standard.count()) > 0) await standard.first().click();
    await this.flow.saveDownload(download, destination);
  }

  async close(): Promise<void> {
    const page = await this.flow.page();
    if (SCENE_URL.test(page.url())) {
      await this.flow.byAria(page, this.flow.labels.sceneDone).first().click().catch(() => undefined);
      await page.waitForTimeout(2_000);
    }
    await this.flow.ensureOnGrid();
  }

  private async scenePage(): Promise<Page> {
    const page = await this.flow.projectPage();
    if (!SCENE_URL.test(page.url())) {
      throw new PreconditionFailedError('No scene is open. Call flow_scene_open first.');
    }
    return page;
  }

  private async openAddClipMenu(page: Page): Promise<void> {
    await this.flow.dismissOverlays(page);
    await this.flow.ui('add clip', () => this.flow.byAria(page, this.flow.labels.addClip).first().click());
    await page.waitForTimeout(1_500);
  }

  /** Edit uses the clip's own prompt box; extend opens a new one, taken as the last visible box. */
  private activeBox(page: Page, action: SceneAction) {
    return action === 'edit' ? page.locator('flow-edit-video-prompt-box').first() : page.locator('flow-base-prompt-box').last();
  }

  private activeEditor(page: Page, action: SceneAction) {
    return this.activeBox(page, action).locator('[contenteditable="true"], textarea').first();
  }
}
