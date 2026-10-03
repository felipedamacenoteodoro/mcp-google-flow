import { assertAssetIndex, isGridSettled, qualitySpendsCredits } from '../../domain/asset.js';
import type { Asset, DownloadQuality } from '../../domain/asset.js';
import { InvalidInputError, NotFoundError, PreconditionFailedError, TimeoutError } from '../../domain/errors.js';
import type { Clock, FileVault, MediaGrid } from '../ports.js';
import type { Quote, SpendGuard } from '../spend-guard.js';

const SAFE_FILE_NAME = /^[\w\-. ]{1,120}$/;

export class AssetUseCases {
  constructor(
    private readonly grid: MediaGrid,
    private readonly vault: FileVault,
    private readonly guard: SpendGuard,
    private readonly clock: Clock,
  ) {}

  list(onlyScenes = false): Promise<Asset[]> {
    return this.grid.showScenes(onlyScenes).then(() => this.grid.listAssets());
  }

  async upload(path: string): Promise<Asset[]> {
    const file = await this.vault.verifyUpload(path);
    await this.grid.showScenes(false);
    await this.grid.upload(file);
    return this.grid.listAssets();
  }

  /** Sends a finished video to the scene builder, where clips are arranged and extended. */
  async addToScene(index: number): Promise<void> {
    const asset = await this.requireReady(assertAssetIndex(index));
    if (asset.kind !== 'video') throw new InvalidInputError('Only videos can be added to a scene.');
    await this.grid.addToScene(index);
  }

  /** Polls the grid until it holds `expectedTotal` finished tiles. */
  async waitUntilSettled(expectedTotal: number, timeoutMs: number, pollMs = 30_000): Promise<Asset[]> {
    if (!Number.isInteger(expectedTotal) || expectedTotal < 1) {
      throw new InvalidInputError('expectedTotal must be a positive integer.');
    }
    const deadline = this.clock.now() + timeoutMs;
    for (;;) {
      const assets = await this.grid.listAssets();
      if (isGridSettled(assets, expectedTotal)) return assets;
      if (this.clock.now() + pollMs > deadline) {
        const ready = assets.filter((a) => a.ready).length;
        throw new TimeoutError(`Grid has ${assets.length} tile(s), ${ready} ready; expected ${expectedTotal}.`);
      }
      await this.clock.sleep(pollMs);
    }
  }

  async download(input: {
    index: number;
    quality: DownloadQuality;
    fileName: string;
    confirm: boolean;
    quoteId?: string;
  }): Promise<{ status: 'quoted'; quote: Quote } | { status: 'saved'; savedTo: string; creditsCharged: number }> {
    if (!SAFE_FILE_NAME.test(input.fileName) || input.fileName.startsWith('.')) {
      throw new InvalidInputError('fileName must be a plain name (letters, digits, space, dot, dash, underscore).');
    }
    const asset = await this.requireReady(assertAssetIndex(input.index));

    if (asset.kind === 'scene') {
      throw new InvalidInputError('Scenes are exported with flow_scene_download.');
    }
    // Flow does not show the upscale price before the click; charge the estimate.
    const credits = qualitySpendsCredits(input.quality) ? this.guard.priceOf(null) : 0;
    const extension = asset.kind === 'video' ? '.mp4' : '.png';
    const request = { download: asset.index, name: asset.name, quality: input.quality };
    if (credits > 0 && !input.confirm) return { status: 'quoted', quote: this.guard.quote(request, credits) };
    const { result: destination, creditsCharged } = await this.guard.spend(
      `download ${input.quality}`,
      credits,
      { confirm: input.confirm, quoteId: input.quoteId, request },
      async () => {
        const target = await this.vault.reserveOutput(withExtension(input.fileName, extension));
        try {
          await this.grid.download(asset.index, input.quality, target);
        } catch (error) {
          await this.vault.discard(target);
          throw error;
        }
        return target;
      },
    );
    return { status: 'saved', savedTo: destination, creditsCharged };
  }

  private async requireReady(index: number): Promise<Asset> {
    const asset = (await this.grid.listAssets()).find((a) => a.index === index);
    if (!asset) throw new NotFoundError(`No tile at index ${index}.`);
    if (!asset.ready) throw new PreconditionFailedError(`Tile ${index} is still processing.`);
    return asset;
  }
}

function withExtension(name: string, extension: string): string {
  return name.toLowerCase().endsWith(extension) ? name : `${name}${extension}`;
}
