import { InvalidInputError } from './errors.js';

export type AssetKind = 'video' | 'image' | 'scene';

/** A tile in the project grid. `index` is its position in the current view, newest first. */
export interface Asset {
  readonly index: number;
  readonly kind: AssetKind;
  readonly name: string;
  readonly ready: boolean;
}

export function assertAssetIndex(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index > 999) {
    throw new InvalidInputError('Asset index must be an integer between 0 and 999.');
  }
  return index;
}

export function isGridSettled(assets: readonly Asset[], expectedTotal: number): boolean {
  return assets.length >= expectedTotal && assets.every((a) => a.ready);
}

/**
 * `standard` is the free export (720p video / original image). Higher
 * resolutions are rendered on demand by Flow and spend credits.
 */
export type DownloadQuality = 'standard' | '1080p' | '4k';

export function qualitySpendsCredits(quality: DownloadQuality): boolean {
  return quality !== 'standard';
}
