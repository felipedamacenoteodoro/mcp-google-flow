import { InvalidInputError } from './errors.js';

/**
 * Flow's composer modes:
 *  - image:  text, plus optional references, to image
 *  - video:  text, plus optional elements (characters, objects, voices), to video
 *  - frames: video that starts and/or ends on chosen images
 */
export const GENERATION_MODES = ['image', 'video', 'frames'] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export const VIDEO_ASPECTS = ['9:16', '16:9'] as const;
export const IMAGE_ASPECTS = ['9:16', '16:9', '1:1', '4:3', '3:4'] as const;
export type AspectRatio = (typeof IMAGE_ASPECTS)[number];

export const VIDEO_RESOLUTIONS = ['360p', '720p'] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

export const VIDEO_DURATIONS = [4, 6, 8, 10] as const;
export type VideoDuration = (typeof VIDEO_DURATIONS)[number];

export const MAX_VARIANTS = 4;

// Model names come from the live UI and change often, so they are free text,
// constrained only to what a menu label can reasonably look like.
const MODEL_NAME = /^[\p{L}\p{N} .\-]{1,60}$/u;

export interface GenerationSettings {
  readonly mode: GenerationMode;
  readonly aspect: AspectRatio;
  readonly variants: number;
  readonly model?: string;
  readonly resolution?: VideoResolution;
  readonly durationSeconds?: VideoDuration;
}

export function isVideoMode(mode: GenerationMode): boolean {
  return mode !== 'image';
}

export function createGenerationSettings(input: {
  mode: GenerationMode;
  aspect: AspectRatio;
  variants?: number;
  model?: string;
  resolution?: VideoResolution;
  durationSeconds?: number;
}): GenerationSettings {
  const variants = input.variants ?? 1;
  if (!Number.isInteger(variants) || variants < 1 || variants > MAX_VARIANTS) {
    throw new InvalidInputError(`variants must be an integer between 1 and ${MAX_VARIANTS}.`);
  }

  const video = isVideoMode(input.mode);
  if (video && !(VIDEO_ASPECTS as readonly string[]).includes(input.aspect)) {
    throw new InvalidInputError(`Video modes support only ${VIDEO_ASPECTS.join(' or ')}.`);
  }
  if (!video && (input.resolution !== undefined || input.durationSeconds !== undefined)) {
    throw new InvalidInputError('resolution and durationSeconds apply only to video modes.');
  }
  if (input.durationSeconds !== undefined && !(VIDEO_DURATIONS as readonly number[]).includes(input.durationSeconds)) {
    throw new InvalidInputError(`durationSeconds must be one of ${VIDEO_DURATIONS.join(', ')}.`);
  }

  const model = input.model?.trim();
  if (model !== undefined && !MODEL_NAME.test(model)) {
    throw new InvalidInputError('model must be a plain menu label (letters, digits, spaces, dots, dashes).');
  }

  return Object.freeze({
    mode: input.mode,
    aspect: input.aspect,
    variants,
    ...(model ? { model } : {}),
    ...(input.resolution ? { resolution: input.resolution } : {}),
    ...(input.durationSeconds ? { durationSeconds: input.durationSeconds as VideoDuration } : {}),
  });
}

/** How many references the composer must hold right before a paid submit. */
export interface ReferenceCount {
  readonly videos: number;
  readonly images: number;
}

export const NO_REFERENCES: ReferenceCount = Object.freeze({ videos: 0, images: 0 });

export function sameReferences(a: ReferenceCount, b: ReferenceCount): boolean {
  return a.videos === b.videos && a.images === b.images;
}

/** What the settings panel shows after configuration, including Flow's own price tag. */
export interface PanelState {
  readonly summary: string;
  /** Credits Flow says the next submit costs, or null when the label is not shown. */
  readonly creditCost: number | null;
}

/** Live catalogue read from the settings panel. */
export interface GenerationOptions {
  readonly modes: string[];
  readonly aspects: string[];
  readonly resolutions: string[];
  readonly durations: string[];
  readonly variants: string[];
  readonly models: string[];
  readonly current: PanelState;
}
