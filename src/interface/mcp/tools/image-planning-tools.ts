import { z } from 'zod';
import type { ImagePlanningUseCases } from '../../../application/use-cases/image-planning.js';
import { ANGLES, IMAGE_TASK_IDS } from '../../../domain/image-tasks.js';
import { defineTool, type ToolRuntime } from '../define-tool.js';
import { ok } from '../tool-result.js';

export function registerImagePlanningTools(rt: ToolRuntime, planning: ImagePlanningUseCases): void {
  defineTool(rt, 'flow_image_prompt', {
    description:
      'Writes the prompt(s) for a base-image job: avatar, identity-sheet, outfit-background, look, angle, product-in-hand, app-screen (step 1 then 2), before-after, swap-person. Returns the prompts, what to attach in order, the aspect and notes. Free: generate with flow_generate mode "image".',
    input: {
      task: z.enum(IMAGE_TASK_IDS),
      who: z.string().max(300).optional(),
      setting: z.string().max(300).optional(),
      framing: z.string().max(200).optional(),
      mood: z.string().max(200).optional(),
      change: z.string().max(300).optional(),
      from_second_image: z.boolean().optional(),
      angle: z.enum(Object.keys(ANGLES) as [string, ...string[]]).optional(),
      how: z.string().max(200).optional(),
      step: z.number().int().min(1).max(2).optional(),
      before: z.string().max(300).optional(),
      after: z.string().max(300).optional(),
    },
    readOnly: true,
  }, async ({ task, from_second_image, ...details }) =>
    ok(planning.imagePrompt(task, { ...stripUndefined(details), ...(from_second_image !== undefined ? { fromSecondImage: from_second_image } : {}) })));
}

function stripUndefined<T extends Record<string, unknown>>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as never;
}
