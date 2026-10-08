import type { MediaGrid, VerifiedFile } from '../../application/ports.js';
import type { Asset, DownloadQuality } from '../../domain/asset.js';
import { FlowUnavailableError, InvalidInputError, PreconditionFailedError } from '../../domain/errors.js';
import { anyOf, APP_SETTLE_MS, exact, FlowPage, TILE } from './flow-page.js';

export class FlowMediaGrid implements MediaGrid {
  constructor(private readonly flow: FlowPage) {}

  async listAssets(): Promise<Asset[]> {
    const page = await this.flow.ensureOnGrid();
    await this.flow.dismissOverlays(page);
    return page.locator(TILE).evaluateAll(
      (tiles, failedPattern) =>
      tiles.map((tile, index) => {
        const text = ((tile as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
        // A failed generation shows Flow's error text instead of media.
        if (new RegExp(failedPattern).test(text)) {
          return { index, kind: 'failed' as const, name: '', ready: false, error: text.replace(new RegExp(failedPattern), '').trim().slice(0, 300) };
        }
        const kind = tile.querySelector('flow-scene-tile')
          ? ('scene' as const)
          : tile.querySelector('flow-video-tile')
            ? ('video' as const)
            : ('image' as const);
        // Material icons render as words (play_circle, movie); keep only the real name.
        const iconWords = new Set(['movie', 'favorite', 'redo', 'image', 'videocam']);
        const name = ((tile as HTMLElement).innerText || '')
          .split(/\s+/)
          // "40%" is upload progress, not a name.
          .filter((word) => !/^[a-z]+(_[a-z0-9]+)+$/.test(word) && !iconWords.has(word) && !/^\d{1,3}%$/.test(word))
          .join(' ')
          .trim();
        // A tile stays grey (no media element) while Flow is still rendering it.
        const ready = tile.querySelector('img, video') !== null;
        return { index, kind, name, ready };
      }),
      this.flow.labels.failedTile,
    );
  }

  async showScenes(onlyScenes: boolean): Promise<void> {
    const page = await this.flow.ensureOnGrid();
    const label = onlyScenes ? this.flow.labels.navScenes : this.flow.labels.navAllMedia;
    await this.flow.ui(`navigation "${label}"`, () =>
      page.locator('flow-project-nav-list').getByText(exact(label)).first().click(),
    );
    await page.waitForTimeout(3_000);
  }

  async upload(file: VerifiedFile): Promise<void> {
    const page = await this.flow.ensureOnGrid();
    const before = await page.locator(TILE).count();

    await this.flow.ui('add files menu', () => this.flow.byAria(page, this.flow.labels.addFilesMenu).first().click());
    await page.waitForTimeout(1_200);
    const chooser = page.waitForEvent('filechooser', { timeout: 25_000 });
    await this.flow.ui('upload action', () =>
      page.locator('button', { hasText: anyOf(this.flow.labels.uploadAction) }).first().click(),
    );
    await (await chooser).setFiles(file.absolutePath);

    // Video uploads may ask the user to confirm they hold the rights to the footage.
    await page
      .getByRole('button', { name: exact(this.flow.labels.acceptRights) })
      .first()
      .click({ timeout: 6_000 })
      .catch(() => undefined);

    // The grid does not always show a new video tile until the page reloads.
    for (let attempt = 1; attempt <= 12; attempt++) {
      if ((await page.locator(TILE).count()) > before) return;
      await page.waitForTimeout(5_000);
      if (attempt % 3 === 0) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(APP_SETTLE_MS);
      }
    }
    throw new FlowUnavailableError('The uploaded file never appeared in the project grid.');
  }

  async addToScene(index: number): Promise<void> {
    const page = await this.flow.ensureOnGrid();
    if (!(await this.flow.openTileMenu(page, index))) {
      throw new PreconditionFailedError(`Tile ${index} has no menu yet.`);
    }
    await this.flow.ui('add to scene', () => this.flow.menuItem(page, this.flow.labels.menuAddToScene).hover());
    await page.waitForTimeout(1_200);
    await this.flow.ui('new scene', () => this.flow.menuItem(page, this.flow.labels.menuNewScene).click());
    await page.waitForTimeout(APP_SETTLE_MS);
  }

  async download(index: number, quality: DownloadQuality, destination: string): Promise<void> {
    const page = await this.flow.ensureOnGrid();
    // A tile that just finished rendering can take a few seconds to get its menu.
    let opened = false;
    for (let attempt = 1; attempt <= 4 && !opened; attempt++) {
      opened = await this.flow.openTileMenu(page, index);
      if (!opened) await page.waitForTimeout(5_000);
    }
    if (!opened) throw new PreconditionFailedError(`Tile ${index} has no menu yet.`);
    await this.flow.ui('download menu', () => this.flow.menuItem(page, this.flow.labels.menuDownload).click());
    await page.waitForTimeout(2_500);

    const option = this.flow.menuItem(page, new RegExp(this.flow.labels.quality[quality]));
    if ((await option.count()) === 0) {
      await this.flow.dismissOverlays(page);
      throw new InvalidInputError(`Quality "${quality}" is not offered for tile ${index}.`);
    }
    const download = page.waitForEvent('download', { timeout: 300_000 });
    await option.click();
    await this.flow.saveDownload(download, destination);
  }
}
