import { z } from 'zod';
import { GENERATION_MODES, IMAGE_ASPECTS, MAX_VARIANTS, VIDEO_DURATIONS, VIDEO_RESOLUTIONS } from '../../domain/generation.js';
import { RESOURCE_CATEGORIES } from '../../domain/library.js';
import { MAX_PROMPT_LENGTH } from '../../domain/prompt.js';

export const prompt = z.string().min(1).max(MAX_PROMPT_LENGTH);

export const confirm = z
  .boolean()
  .default(false)
  .describe('false = prepare only: shows the price and returns a quote, spends nothing. true = spend; requires quote_id.');

export const quoteId = z
  .string()
  .regex(/^[0-9a-f]{8}$/)
  .optional()
  .describe('quote.quoteId from the confirm=false call for this exact request. Valid 10 minutes, single use.');

/** Both approval fields, for every tool that can spend credits. */
export const approval = { confirm, quote_id: quoteId };

export const tileIndex = z.number().int().min(0).max(999).describe('Tile position in the current grid view, 0 = newest.');

export const fileName = z.string().min(1).max(120).describe('Plain file name; the extension is added if missing.');

export const resourceName = z.string().min(1).max(120).describe('Resource name as listed by flow_find_resources.');

export const category = z.enum(RESOURCE_CATEGORIES).default('all');

export const settings = {
  mode: z.enum(GENERATION_MODES).describe('image, video (text + optional elements) or frames (start/end images).'),
  aspect: z.enum(IMAGE_ASPECTS).describe('Video modes accept only 9:16 or 16:9.'),
  variants: z.number().int().min(1).max(MAX_VARIANTS).default(1).describe('Outputs per prompt; multiplies the price.'),
  model: z.string().max(60).optional().describe('Exact model name from flow_list_options. Omit to keep the current one.'),
  resolution: z.enum(VIDEO_RESOLUTIONS).optional().describe('Video only.'),
  duration_seconds: z
    .number()
    .int()
    .refine((n) => (VIDEO_DURATIONS as readonly number[]).includes(n), 'Use 4, 6, 8 or 10.')
    .optional()
    .describe('Video only: 4, 6, 8 or 10.'),
};

export const attachments = {
  attach_tiles: z.array(tileIndex).max(10).optional().describe('Grid tiles to attach as references.'),
  attach_resources: z.array(resourceName).max(10).optional().describe('Named resources to attach, like typing "@name": characters, voices, images, videos.'),
};

/** Maps the snake_case tool arguments to the use-case input. */
export function toSettings(a: {
  mode: (typeof GENERATION_MODES)[number];
  aspect: (typeof IMAGE_ASPECTS)[number];
  variants: number;
  model?: string | undefined;
  resolution?: (typeof VIDEO_RESOLUTIONS)[number] | undefined;
  duration_seconds?: number | undefined;
}) {
  return {
    mode: a.mode,
    aspect: a.aspect,
    variants: a.variants,
    ...(a.model ? { model: a.model } : {}),
    ...(a.resolution ? { resolution: a.resolution } : {}),
    ...(a.duration_seconds ? { durationSeconds: a.duration_seconds } : {}),
  };
}
