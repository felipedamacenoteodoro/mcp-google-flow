import type { Frame, Page } from 'playwright-core';
import type { ToolHost } from '../../application/ports.js';
import { FlowUnavailableError, NotFoundError, PreconditionFailedError } from '../../domain/errors.js';
import type { OpenedTool, ToolControl, ToolControlKind, ToolSource, ToolSummary } from '../../domain/tools.js';
import { APP_SETTLE_MS, exact, FlowPage } from './flow-page.js';

const TOOL_URL = /\/tool\/[0-9a-f-]{36}/;
const CONTROL_ID_ATTR = 'data-flow-studio-control';

/**
 * Flow tools (applets) run in a sandboxed iframe on a googleusercontent host.
 * Each one has its own UI, so this adapter exposes them generically: it tags
 * the visible controls with ids, then fills or clicks them by id.
 *
 * Opening a Google template creates a personal copy named "Remix of <name>";
 * an existing copy is reused so repeated calls do not pile up duplicates.
 */
export class FlowToolHost implements ToolHost {
  constructor(private readonly flow: FlowPage) {}

  async list(source: ToolSource): Promise<ToolSummary[]> {
    const page = await this.goToGallery(source);
    return page.locator('flow-applet-card').evaluateAll((cards) =>
      cards.map((card) => {
        const lines = ((card as HTMLElement).innerText || '').split('\n').map((l) => l.trim()).filter((l) => l && l !== 'more_vert');
        return { name: lines[0] ?? '', author: lines[1] ?? '', description: lines.slice(2).join(' ') };
      }),
    );
  }

  async open(name: string): Promise<OpenedTool> {
    const remix = `${this.flow.labels.remixPrefix}${name}`;
    const ownCopy = await this.findCard('mine', [name, remix]);
    let createdCopy = false;
    if (!ownCopy) {
      const found = (await this.findCard('templates', [name])) ?? (await this.findCard('community', [name]));
      if (!found) throw new NotFoundError(`No tool named "${name}" in your tools, the templates or the community gallery.`);
      createdCopy = true;
    }
    const page = await this.flow.page();
    await page.waitForURL(TOOL_URL, { timeout: 30_000 });
    await page.waitForTimeout(APP_SETTLE_MS);
    return { name, createdCopy, controls: await this.controls() };
  }

  async controls(): Promise<ToolControl[]> {
    const frame = await this.toolFrame();
    return frame.evaluate((attr) => {
      const visible = (e: Element) => {
        const box = e.getBoundingClientRect();
        return box.width > 2 && box.height > 2;
      };
      const nodes = [...document.querySelectorAll('button, input, textarea, select, [role=button], [contenteditable=true]')].filter(visible);
      return nodes.map((node, id) => {
        node.setAttribute(attr, String(id));
        const el = node as HTMLInputElement;
        const tag = node.tagName.toLowerCase();
        const kind = tag === 'select' ? 'choice' : tag === 'textarea' || (tag === 'input' && !['button', 'submit', 'checkbox', 'radio'].includes(el.type)) || node.hasAttribute('contenteditable') ? 'text' : 'button';
        const label =
          node.getAttribute('aria-label') ||
          (el.labels?.[0]?.innerText ?? '') ||
          ((node as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim() ||
          el.placeholder ||
          el.value ||
          tag;
        const value =
          kind === 'button'
            ? undefined
            : tag === 'select'
              ? ((node as HTMLSelectElement).selectedOptions[0]?.text ?? '')
              : node.hasAttribute('contenteditable')
                ? (node as HTMLElement).innerText
                : el.value;
        const labelText = kind === 'text' && tag !== 'select' ? (node.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.placeholder || tag) : label;
        return {
          id,
          kind: kind as 'button' | 'text' | 'choice',
          label: labelText.slice(0, 120),
          ...(value !== undefined ? { value: value.slice(0, 500) } : {}),
        };
      });
    }, CONTROL_ID_ATTR) as Promise<{ id: number; kind: ToolControlKind; label: string; value?: string }[]>;
  }

  async fill(controlId: number, value: string): Promise<void> {
    const control = await this.control(controlId);
    const tag = await control.evaluate((e) => e.tagName.toLowerCase());
    if (tag === 'select') await control.selectOption({ label: value });
    else await control.fill(value);
  }

  async click(controlId: number): Promise<void> {
    const control = await this.control(controlId);
    await control.click();
    await (await this.flow.page()).waitForTimeout(2_000);
  }

  async close(): Promise<void> {
    await this.flow.ensureOnGrid();
  }

  // ------------------------------------------------------------------ helpers

  private async goToGallery(source: ToolSource): Promise<Page> {
    const root = await this.flow.projectRoot();
    const page = await this.flow.page();
    const target = `${root}${this.flow.labels.toolsPath}`;
    if (page.url().split('?')[0] !== target) {
      await this.flow.open(page, target);
      await page.waitForTimeout(APP_SETTLE_MS);
    }
    await this.flow.ui(`tools tab "${source}"`, () =>
      page.getByRole('radio', { name: exact(this.flow.labels.toolTabs[source]) }).click(),
    );
    await page.waitForTimeout(3_000);
    return page;
  }

  /** Opens the first card whose name is one of `names`; returns false when none matches. */
  private async findCard(source: ToolSource, names: string[]): Promise<boolean> {
    const page = await this.goToGallery(source);
    const cards = page.locator('flow-applet-card');
    const titles = await cards.evaluateAll((all) => all.map((c) => ((c as HTMLElement).innerText || '').split('\n')[0]!.trim()));
    const index = titles.findIndex((title) => names.includes(title));
    if (index < 0) return false;
    await cards.nth(index).locator('img').first().click();
    return true;
  }

  private async toolFrame(): Promise<Frame> {
    const page = await this.flow.projectPage();
    if (!TOOL_URL.test(page.url())) throw new PreconditionFailedError('No tool is open. Call flow_tool_open first.');
    const candidates = page.frames().filter((f) => f.url().includes(this.flow.labels.toolFrameHost));
    let best: Frame | null = null;
    let most = 0;
    for (const frame of candidates) {
      const count = await frame.locator('button, input, textarea, select').count().catch(() => 0);
      if (count > most) [best, most] = [frame, count];
    }
    if (!best) throw new FlowUnavailableError('The tool has not rendered any controls yet. Try flow_tool_controls again.');
    return best;
  }

  private async control(controlId: number) {
    const frame = await this.toolFrame();
    const control = frame.locator(`[${CONTROL_ID_ATTR}="${controlId}"]`);
    if ((await control.count()) === 0) {
      throw new NotFoundError(`No control ${controlId}. Call flow_tool_controls again; ids change as the tool re-renders.`);
    }
    return control.first();
  }
}
