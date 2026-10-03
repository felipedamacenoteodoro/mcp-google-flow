import { CAMERA_MOVES, MICRO_ACTIONS, REVIEW_CHECKLIST } from '../../domain/craft.js';
import type { CameraMoveId, ShotRole } from '../../domain/craft.js';
import { InvalidInputError } from '../../domain/errors.js';
import { DEFAULT_STYLES, LAYOUTS, planShots, UNIVERSAL_RULES } from '../../domain/shot-planner.js';
import type { CastMember, Layout, ShotPlan, ShotStyle } from '../../domain/shot-planner.js';

const SHOT_SECONDS = [4, 6, 8, 10] as const;

export interface PlanRequest {
  layout: Layout;
  script: string;
  cast: CastMember[];
  setting: string;
  language: string;
  shotSeconds: number;
  accent?: string;
  look?: string;
  baseImage?: string;
  aspect?: '9:16' | '16:9';
  /** Overrides the layout's default framings. */
  framings?: string[];
  /** Overrides camera moves per shot role. */
  camera?: Partial<Record<ShotRole, CameraMoveId>>;
  /** Extra rules appended to the plan. */
  rules?: string[];
}

/** Pure planning: no browser involved, nothing spent. The plan feeds flow_run_shot_list. */
export class ShotPlanningUseCases {
  /** The directing toolkit: layouts, camera moves by purpose, gestures, rules and the review checklist. */
  guide() {
    return {
      layouts: LAYOUTS.map((layout) => ({ layout, defaults: DEFAULT_STYLES[layout] })),
      cameraMoves: Object.values(CAMERA_MOVES),
      gestures: MICRO_ACTIONS,
      universalRules: UNIVERSAL_RULES,
      reviewChecklist: REVIEW_CHECKLIST,
    };
  }

  plan(request: PlanRequest): ShotPlan {
    if (!(SHOT_SECONDS as readonly number[]).includes(request.shotSeconds)) {
      throw new InvalidInputError('shotSeconds must be 4, 6, 8 or 10.');
    }
    const base = DEFAULT_STYLES[request.layout];
    const style: ShotStyle = {
      layout: request.layout,
      aspect: request.aspect ?? base.aspect,
      framings: request.framings?.length ? request.framings : base.framings,
      camera: { ...base.camera, ...request.camera },
      rules: [...base.rules, ...(request.rules ?? [])],
    };
    return planShots({
      style,
      script: request.script,
      cast: request.cast,
      setting: request.setting,
      language: request.language,
      shotSeconds: request.shotSeconds as (typeof SHOT_SECONDS)[number],
      ...(request.accent ? { accent: request.accent } : {}),
      ...(request.look ? { look: request.look } : {}),
      ...(request.baseImage ? { baseImage: request.baseImage } : {}),
    });
  }
}
