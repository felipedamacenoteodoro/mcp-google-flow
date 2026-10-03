import { z } from 'zod';
import type { AssetUseCases } from '../../../application/use-cases/assets.js';
import { defineTool, type ToolRuntime } from '../define-tool.js';
import { approval, fileName, tileIndex } from '../schemas.js';
import { ok } from '../tool-result.js';

export function registerGridTools(rt: ToolRuntime, assets: AssetUseCases): void {
  defineTool(rt, 'flow_list_assets', {
    description: 'Lists the tiles of the open project: index, kind (video/image/scene), name and whether rendering finished. scenes_only=true shows only scenes.',
    input: { scenes_only: z.boolean().default(false) },
    readOnly: true,
  }, async ({ scenes_only }) => ok(await assets.list(scenes_only)));

  defineTool(rt, 'flow_upload', {
    description: 'Uploads a local PNG/JPEG/WEBP/MP4/MOV/WEBM into the open project. The path must be absolute and inside an allowed input folder.',
    input: { path: z.string().min(1).max(1024) },
  }, async ({ path }) => ok({ assets: await assets.upload(path) }));

  defineTool(rt, 'flow_wait', {
    description: 'Waits until the project grid holds expected_total tiles and all of them finished rendering.',
    input: { expected_total: z.number().int().min(1).max(999), timeout_minutes: z.number().min(1).max(30).default(12) },
    readOnly: true,
  }, async (a) => ok(await assets.waitUntilSettled(a.expected_total, a.timeout_minutes * 60_000)));

  defineTool(rt, 'flow_download', {
    description: 'Saves a finished video or image into the output folder. "standard" (720p / original) is free; "1080p" and "4k" are upscaled by Flow and spend credits: the first call returns a quote, the second needs confirm=true and its quote_id.',
    input: { index: tileIndex, quality: z.enum(['standard', '1080p', '4k']).default('standard'), file_name: fileName, ...approval },
  }, async (a) => ok(await assets.download({ index: a.index, quality: a.quality, fileName: a.file_name, confirm: a.confirm, ...(a.quote_id ? { quoteId: a.quote_id } : {}) })));

  defineTool(rt, 'flow_add_to_scene', {
    description: 'Creates a new scene from a finished video, so it can be extended, edited and exported with the flow_scene_* tools.',
    input: { index: tileIndex },
  }, async ({ index }) => {
    await assets.addToScene(index);
    return ok({ addedToNewScene: index, next: 'Call flow_list_assets with scenes_only=true, then flow_scene_open.' });
  });
}
