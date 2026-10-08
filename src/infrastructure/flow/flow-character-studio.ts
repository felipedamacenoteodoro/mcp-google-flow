import type { Page } from 'playwright-core';
import type { CharacterStudio } from '../../application/ports.js';
import { InvalidInputError } from '../../domain/errors.js';
import type { PanelState, SubmitResult } from '../../domain/generation.js';
import type { Prompt } from '../../domain/prompt.js';
import { APP_SETTLE_MS, FlowPage, OVERLAY, stripIcon } from './flow-page.js';

/** The project's character page: preset archetypes, a description box and an image model. */
export class FlowCharacterStudio implements CharacterStudio {
  constructor(private readonly flow: FlowPage) {}

  async open(): Promise<{ presets: string[]; model: string }> {
    const page = await this.goToStudio();
    const presets = await page
      .locator('flow-character-preset-card')
      .evaluateAll((cards) => cards.map((c) => ((c as HTMLElement).innerText || '').split('\n')[0]!.trim()).filter(Boolean));
    const model = stripIcon((await this.modelButton(page).innerText().catch(() => '')).replace('arrow_drop_down', ''))
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .trim();
    return { presets, model };
  }

  async prepare(input: { preset?: string; prompt: Prompt; model?: string }): Promise<PanelState> {
    const page = await this.goToStudio();
    if (input.preset) {
      const card = page.locator('flow-character-preset-card', { hasText: input.preset }).first();
      if ((await card.count()) === 0) throw new InvalidInputError(`No character preset named "${input.preset}".`);
      await card.click();
      await page.waitForTimeout(1_500);
    }
    if (input.model) await this.selectModel(page, input.model);
    await this.flow.typeInto(this.editor(page), input.prompt);
    return this.flow.panelState(page, this.modelButton(page));
  }

  async submit(): Promise<SubmitResult> {
    const page = await this.flow.projectPage();
    return this.flow.pressGenerate(
      this.flow.byAria(page.locator('flow-character-prompt-box'), this.flow.labels.submit).first(),
      'character submit',
    );
  }

  async leave(): Promise<void> {
    await this.flow.ensureOnGrid();
  }

  private async goToStudio(): Promise<Page> {
    const root = await this.flow.projectRoot();
    const page = await this.flow.projectPage();
    const target = `${root}${this.flow.labels.characterPath}`;
    if (!page.url().startsWith(target)) {
      await this.flow.open(page, target);
      await page.waitForTimeout(APP_SETTLE_MS);
    }
    return page;
  }

  private editor(page: Page) {
    return page.locator('flow-character-prompt-box [contenteditable="true"], flow-character-prompt-box textarea').first();
  }

  private modelButton(page: Page) {
    return this.flow.byAria(page, this.flow.labels.modelFamily).first();
  }

  private async selectModel(page: Page, model: string): Promise<void> {
    await this.flow.ui('character model menu', () => this.modelButton(page).click());
    await page.waitForTimeout(1_200);
    const item = page.locator(`${OVERLAY} [role=menuitem]`, { hasText: model }).first();
    if ((await item.count()) === 0) {
      await this.flow.dismissOverlays(page);
      throw new InvalidInputError(`Model "${model}" is not offered for characters.`);
    }
    await item.click();
    await page.waitForTimeout(1_200);
  }
}
