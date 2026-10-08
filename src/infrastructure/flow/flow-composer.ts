import type { Locator, Page } from 'playwright-core';
import type { Composer } from '../../application/ports.js';
import { InvalidInputError, PreconditionFailedError } from '../../domain/errors.js';
import type { GenerationOptions, GenerationSettings, PanelState, ReferenceCount, SubmitResult } from '../../domain/generation.js';
import type { Prompt } from '../../domain/prompt.js';
import { alternatives, anyOf, exact, FlowPage, isOneOf, OVERLAY, stripIcon } from './flow-page.js';
import type { FlowResourceLibrary } from './flow-resource-library.js';

/**
 * The prompt box at the bottom of the project grid and its settings panel.
 *
 * Panel quirks (observed 2026-09-29): the trigger has no aria-expanded, so
 * "open" means its radio buttons are visible; after Escape the next trigger
 * click is swallowed, so the panel is closed by clicking outside instead.
 */
export class FlowComposer implements Composer {
  constructor(
    private readonly flow: FlowPage,
    private readonly library: FlowResourceLibrary,
  ) {}

  async readOptions(): Promise<GenerationOptions> {
    const page = await this.flow.ensureOnGrid();
    await this.openPanel(page);
    let radios: string[], models: string[], current: PanelState;
    try {
      radios = await this.radioTexts(page);
      models = await this.readModels(page);
      current = await this.flow.panelState(page, this.trigger(page));
    } finally {
      await this.closePanel(page);
    }

    const pick = (pattern: RegExp) => radios.filter((r) => pattern.test(r));
    const { modeImage, modeVideo, videoInputFrames, videoInputElements } = this.flow.labels;
    return {
      modes: radios.filter((r) => [modeImage, modeVideo, videoInputFrames, videoInputElements].some((label) => isOneOf(r, label))),
      aspects: pick(/^\d+:\d+$/),
      resolutions: pick(/^\d+p$/),
      durations: pick(/^\d+s$/),
      variants: pick(/^x\d$/),
      models,
      current,
    };
  }

  async configure(settings: GenerationSettings): Promise<PanelState> {
    const page = await this.flow.ensureOnGrid();
    await this.openPanel(page);
    // Always close the panel, even on a rejected option; a panel left open breaks the next call.
    try {
      const labels = this.flow.labels;
      await this.choose(page, settings.mode === 'image' ? labels.modeImage : labels.modeVideo);
      if (settings.mode !== 'image') {
        await this.choose(page, settings.mode === 'frames' ? labels.videoInputFrames : labels.videoInputElements);
      }
      await this.choose(page, settings.aspect);
      // The model decides which resolutions and durations exist, so it goes first.
      if (settings.model) await this.selectModel(page, settings.model);
      if (settings.resolution) await this.choose(page, settings.resolution);
      if (settings.durationSeconds) await this.choose(page, `${settings.durationSeconds}s`);
      await this.choose(page, `x${settings.variants}`);
      return await this.flow.panelState(page, this.trigger(page));
    } finally {
      await this.closePanel(page);
    }
  }

  async panelState(): Promise<PanelState> {
    const page = await this.flow.ensureOnGrid();
    await this.openPanel(page);
    const state = await this.flow.panelState(page, this.trigger(page));
    await this.closePanel(page);
    return state;
  }

  async attachAsset(index: number): Promise<void> {
    const page = await this.flow.ensureOnGrid();
    // A freshly uploaded video takes 30-60s before its tile gets a menu.
    for (let attempt = 1; attempt <= 8; attempt++) {
      if (await this.flow.openTileMenu(page, index)) {
        await this.flow.ui('include in composer', () =>
          this.flow.menuItem(page, this.flow.labels.menuIncludeInComposer).click(),
        );
        await page.waitForTimeout(2_500);
        return;
      }
      this.flow.logger.info('tile not ready for attach yet', { index, attempt });
      await page.waitForTimeout(10_000);
    }
    throw new PreconditionFailedError(`Tile ${index} never became ready to attach.`);
  }

  async setFrame(slot: 'start' | 'end', resourceName: string): Promise<void> {
    const page = await this.flow.ensureOnGrid();
    const label = slot === 'start' ? this.flow.labels.frameStart : this.flow.labels.frameEnd;
    await this.flow.ui(`${slot} frame slot`, () =>
      page.locator('flow-prompt-box button', { hasText: exact(label) }).first().click(),
    );
    await page.waitForTimeout(1_500);
    await this.library.pickInOpenPicker(page, resourceName, null);
  }

  async clear(): Promise<void> {
    const page = await this.flow.ensureOnGrid();
    const button = this.flow.byAria(page, this.flow.labels.clearComposer);
    if ((await button.count()) > 0 && (await button.first().isVisible())) {
      await button.first().click();
    } else {
      // Attached chips live inside the editor, so select-all + delete removes them too.
      await this.editor(page).click();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Backspace');
    }
    await page.waitForTimeout(1_000);
  }

  async references(): Promise<ReferenceCount> {
    const page = await this.flow.ensureOnGrid();
    return page.locator('flow-prompt-box img').evaluateAll(
      (imgs, { prefixes, videoMarker }) => {
        const marker = new RegExp(videoMarker, 'i');
        const alts = imgs.map((img) => (img as HTMLImageElement).alt).filter((alt) => prefixes.some((p) => alt.startsWith(p)));
        const videos = alts.filter((alt) => marker.test(alt)).length;
        return { videos, images: alts.length - videos };
      },
      { prefixes: alternatives(this.flow.labels.referenceAltPrefix), videoMarker: anyOf(this.flow.labels.referenceVideoMarker).source },
    );
  }

  async writePrompt(prompt: Prompt): Promise<void> {
    const page = await this.flow.ensureOnGrid();
    // Place the caret at the end so attached chips are kept.
    await this.flow.ui('prompt editor', () => this.editor(page).click());
    await page.keyboard.press('ControlOrMeta+End');
    for (const [i, line] of prompt.lines.entries()) {
      if (i > 0) await page.keyboard.press('Shift+Enter');
      if (line.length > 0) await page.keyboard.type(line, { delay: 2 });
    }
    await page.waitForTimeout(1_000);
  }

  async submit(): Promise<SubmitResult> {
    const page = await this.flow.ensureOnGrid();
    return this.flow.pressGenerate(this.flow.byAria(page.locator('flow-prompt-box'), this.flow.labels.submit).first(), 'submit');
  }

  // ------------------------------------------------------------------ panel

  private trigger(page: Page): Locator {
    return this.flow.byAria(page, this.flow.labels.settingsTrigger).first();
  }

  private editor(page: Page): Locator {
    return page.locator('flow-prompt-box [contenteditable="true"], flow-prompt-box textarea').first();
  }

  private async isPanelOpen(page: Page): Promise<boolean> {
    return (await page.locator(`${OVERLAY} button[role=radio]:visible`).count()) > 0;
  }

  private async openPanel(page: Page): Promise<void> {
    for (let attempt = 0; attempt < 3 && !(await this.isPanelOpen(page)); attempt++) {
      await this.flow.ui('settings panel', () => this.trigger(page).click());
      await page.waitForTimeout(1_500);
    }
    if (!(await this.isPanelOpen(page))) {
      throw new PreconditionFailedError('The settings panel did not open.');
    }
  }

  private async closePanel(page: Page): Promise<void> {
    if (await this.isPanelOpen(page)) await this.flow.dismissOverlays(page);
  }

  private async radioTexts(page: Page): Promise<string[]> {
    const raw = await page
      .locator(`${OVERLAY} button[role=radio]`)
      .evaluateAll((buttons) => buttons.map((b) => (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
    return raw.map(stripIcon);
  }

  /** Clicks the radio whose label (icon stripped) equals `label`, unless it is already checked. */
  private async choose(page: Page, label: string): Promise<void> {
    const radios = page.locator(`${OVERLAY} button[role=radio]`);
    const texts = await this.radioTexts(page);
    const index = texts.findIndex((text) => isOneOf(text, label));
    if (index < 0) {
      throw new InvalidInputError(`Flow does not offer "${label}" here. Available: ${texts.join(', ')}.`);
    }
    const radio = radios.nth(index);
    if ((await radio.getAttribute('aria-checked')) !== 'true') {
      await radio.click();
      await page.waitForTimeout(1_200);
    }
  }

  private async readModels(page: Page): Promise<string[]> {
    const family = this.flow.byAria(page.locator(OVERLAY), this.flow.labels.modelFamily).first();
    if ((await family.count()) === 0) return [];
    await family.click();
    await page.waitForTimeout(1_200);
    const models = (await page.locator(`${OVERLAY} [role=menuitem]`).allInnerTexts()).map(cleanModel);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    return models;
  }

  private async selectModel(page: Page, model: string): Promise<void> {
    const family = this.flow.byAria(page.locator(OVERLAY), this.flow.labels.modelFamily).first();
    if (cleanModel(await family.innerText()) === model) return;
    await this.flow.ui('model menu', () => family.click());
    await page.waitForTimeout(1_200);
    const items = page.locator(`${OVERLAY} [role=menuitem]`);
    const names = (await items.allInnerTexts()).map(cleanModel);
    const index = names.indexOf(model);
    if (index < 0) {
      await page.keyboard.press('Escape');
      throw new InvalidInputError(`Model "${model}" is not offered in this mode. Available: ${names.join(', ')}.`);
    }
    await items.nth(index).click();
    await page.waitForTimeout(1_200);
  }
}

/** "volume_up Omni 1.1 Flash" / "🍌 Nano Banana 2 arrow_drop_down" -> the plain model name. */
function cleanModel(text: string): string {
  return stripIcon(text.replace(/\barrow_drop_down\b/, ''))
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim();
}
