import { InvalidInputError } from './errors.js';

/** `failed` is a generation Flow could not finish; it occupies a grid position but holds no media. */
export type AssetKind = 'video' | 'image' | 'scene' | 'failed';

/** A tile in the project grid. `index` is its position in the current view, newest first. */
export interface Asset {
  readonly index: number;
  readonly kind: AssetKind;
  readonly name: string;
  readonly ready: boolean;
  /** Flow's own explanation, for failed tiles. */
  readonly error?: string;
}

export function assertAssetIndex(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index > 999) {
    throw new InvalidInputError('Asset index must be an integer between 0 and 999.');
  }
  return index;
}

/** Counts only real media: failed generations never become ready and must not be waited for. */
export function isGridSettled(assets: readonly Asset[], expectedTotal: number): boolean {
  const media = assets.filter((a) => a.kind !== 'failed');
  return media.length >= expectedTotal && media.every((a) => a.ready);
}

/**
 * A wait cannot succeed any more when nothing is still rendering, fewer media
 * than expected exist, and Flow reported at least one failed generation.
 */
export function failedGenerations(assets: readonly Asset[], expectedTotal: number): Asset[] {
  const media = assets.filter((a) => a.kind !== 'failed');
  const stillRendering = media.some((a) => !a.ready);
  const failures = assets.filter((a) => a.kind === 'failed');
  return !stillRendering && media.length < expectedTotal ? failures : [];
}

/**
 * `standard` is the free export (720p video / original image). Higher
 * resolutions are rendered on demand by Flow and spend credits.
 */
export type DownloadQuality = 'standard' | '1080p' | '4k';

export function qualitySpendsCredits(quality: DownloadQuality): boolean {
  return quality !== 'standard';
}
