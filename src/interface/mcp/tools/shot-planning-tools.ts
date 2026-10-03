import { z } from 'zod';
import type { ShotPlanningUseCases } from '../../../application/use-cases/shot-planning.js';
import { CAMERA_MOVES } from '../../../domain/craft.js';
import type { CameraMoveId, ShotRole } from '../../../domain/craft.js';
import { LAYOUTS } from '../../../domain/shot-planner.js';
import { defineTool, type ToolRuntime } from '../define-tool.js';
import { ok } from '../tool-result.js';

const cameraMove = z.enum(Object.keys(CAMERA_MOVES) as [CameraMoveId, ...CameraMoveId[]]);

const castMember = z.object({
  name: z.string().min(1).max(40).describe('Name used in the script, e.g. "Ana" for lines like "Ana: ...".'),
  description: z.string().min(1).max(400).describe('Visual description repeated in every shot: age, hair, clothes.'),
  voice: z
    .union([
      z.string().min(1).max(300),
      z.object({ gender: z.string(), age: z.string(), pitch: z.string(), texture: z.string(), delivery: z.string() }),
    ])
    .optional()
    .describe('Voice repeated in every clip, as text or as {gender, age, pitch, texture, delivery}.'),
  position: z.enum(['left', 'right']).optional().describe('two-in-frame only: side of the shared frame.'),
  resource: z.string().max(120).optional().describe('Library resource to attach (a character or reference image).'),
});

export function registerShotPlanningTools(rt: ToolRuntime, planning: ShotPlanningUseCases): void {
  defineTool(rt, 'flow_directing_guide', {
    description:
      'The directing toolkit behind flow_plan_shots: layouts and their defaults, camera moves by purpose, natural gestures, prompt rules and the review checklist for every take.',
    readOnly: true,
  }, async () => ok(planning.guide()));

  defineTool(rt, 'flow_plan_shots', {
    description:
      'Turns a script into one shot per spoken sentence and drafts each Flow prompt: scene, camera chosen by the shot\'s role (hook, body, key line, call to action), gesture, line, voice, accent and a single-take instruction. ' +
      'Layouts: solo (one person to the lens), two-in-frame (both in every shot, one talks), alternating (each shot shows only the speaker), narration (silent shots). ' +
      'Script markers: "Ana: line" sets the speaker, "[gesture]" in English at the start or end of a line, a leading "*" marks the key line. Free: touches nothing in Flow. Show the plan and its warnings, then pass the shots to flow_run_shot_list.',
    input: {
      layout: z.enum(LAYOUTS),
      script: z.string().min(1).max(8000),
      cast: z.array(castMember).max(2).default([]),
      setting: z.string().min(1).max(300).describe('Where it happens, e.g. "a bright coffee shop".'),
      language: z.string().min(1).max(40).default('English'),
      accent: z.string().max(40).optional(),
      look: z.string().max(200).optional().describe('Look and mood, e.g. "natural daylight, realistic, shot on phone".'),
      shot_seconds: z.number().int().default(8).describe('4, 6, 8 or 10.'),
      base_image: z.string().max(120).optional().describe('Library image every clip is animated from (frames mode). Recommended for two-in-frame: one image with both people.'),
      aspect: z.enum(['9:16', '16:9']).optional(),
      framings: z.array(z.string().min(1).max(200)).max(6).optional().describe('Overrides the layout\'s framings, cycled through the shots.'),
      camera: z
        .object({ hook: cameraMove, body: cameraMove, 'key-line': cameraMove, 'call-to-action': cameraMove, reaction: cameraMove, 'b-roll': cameraMove })
        .partial()
        .optional()
        .describe('Overrides the camera move per shot role (ids from flow_directing_guide).'),
      rules: z.array(z.string().min(1).max(300)).max(10).optional().describe('Extra rules to show with the plan.'),
    },
    readOnly: true,
  }, async (a) =>
    ok(
      planning.plan({
        layout: a.layout,
        script: a.script,
        cast: a.cast.map((c) => ({
          name: c.name,
          description: c.description,
          ...(c.voice ? { voice: c.voice } : {}),
          ...(c.position ? { position: c.position } : {}),
          ...(c.resource ? { resource: c.resource } : {}),
        })),
        setting: a.setting,
        language: a.language,
        shotSeconds: a.shot_seconds,
        ...(a.accent ? { accent: a.accent } : {}),
        ...(a.look ? { look: a.look } : {}),
        ...(a.base_image ? { baseImage: a.base_image } : {}),
        ...(a.aspect ? { aspect: a.aspect } : {}),
        ...(a.framings ? { framings: a.framings } : {}),
        ...(a.camera ? { camera: stripUndefined(a.camera) } : {}),
        ...(a.rules ? { rules: a.rules } : {}),
      }),
    ));
}

function stripUndefined(camera: Partial<Record<ShotRole, CameraMoveId | undefined>>): Partial<Record<ShotRole, CameraMoveId>> {
  return Object.fromEntries(Object.entries(camera).filter(([, v]) => v !== undefined));
}
