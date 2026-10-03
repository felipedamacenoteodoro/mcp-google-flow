import { z } from 'zod';
import type { GenerationUseCases } from '../../../application/use-cases/generation.js';
import { defineTool, type ToolRuntime } from '../define-tool.js';
import { attachments, approval, prompt, resourceName, settings, toSettings } from '../schemas.js';
import { ok } from '../tool-result.js';

export function registerGenerationTools(rt: ToolRuntime, generation: GenerationUseCases): void {
  defineTool(rt, 'flow_list_options', {
    description: 'Reads the live catalogue from Flow: modes, models, aspect ratios, resolutions, durations, variants and the current price in credits. Call before choosing a model.',
    readOnly: true,
  }, async () => ok(await generation.options()));

  defineTool(rt, 'flow_generate', {
    description:
      'Generates images or videos. Clears the composer, configures mode/model/aspect/resolution/duration/variants, attaches references (grid tiles or named resources), sets frames, and types the prompt. confirm=false stops there and returns Flow\'s price with a quote; confirm=true plus that quote_id re-checks the attachments and submits.',
    input: {
      prompt,
      ...settings,
      ...attachments,
      start_frame: resourceName.optional().describe('Frames mode: image for the first frame.'),
      end_frame: resourceName.optional().describe('Frames mode: image for the last frame.'),
      ...approval,
    },
  }, async (a) =>
    ok(
      await generation.generate({
        ...toSettings(a),
        prompt: a.prompt,
        ...(a.attach_tiles ? { attachIndices: a.attach_tiles } : {}),
        ...(a.attach_resources ? { attachResources: a.attach_resources } : {}),
        ...(a.start_frame ? { startFrame: a.start_frame } : {}),
        ...(a.end_frame ? { endFrame: a.end_frame } : {}),
        confirm: a.confirm,
        ...(a.quote_id ? { quoteId: a.quote_id } : {}),
      }),
    ));

  defineTool(rt, 'flow_run_shot_list', {
    description:
      'Generates a sequence of shots with shared settings, e.g. the same character across a story. Each shot can attach its own references. confirm=false prepares the first shot and quotes the whole list; confirm=true plus that quote_id checks the budget for every shot before the first submit.',
    input: {
      shots: z
        .array(z.object({ prompt, ...attachments, start_frame: resourceName.optional().describe('Frames mode: image this shot is animated from.') }))
        .min(1)
        .max(20),
      ...settings,
      ...approval,
    },
  }, async (a) =>
    ok(
      await generation.runShotList({
        ...toSettings(a),
        shots: a.shots.map((s) => ({
          prompt: s.prompt,
          ...(s.attach_tiles ? { attachIndices: s.attach_tiles } : {}),
          ...(s.attach_resources ? { attachResources: s.attach_resources } : {}),
          ...(s.start_frame ? { startFrame: s.start_frame } : {}),
        })),
        confirm: a.confirm,
        ...(a.quote_id ? { quoteId: a.quote_id } : {}),
      }),
    ));
}
