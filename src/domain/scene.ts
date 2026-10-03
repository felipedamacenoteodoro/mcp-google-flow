/**
 * A scene is Flow's timeline of clips. Clips can be extended with a new
 * generated continuation, edited with a prompt, and the whole scene exported
 * as a single video.
 */
export interface SceneSummary {
  readonly url: string;
  readonly clips: string[];
}

export interface ExtendAvailability {
  readonly available: boolean;
  /** Model Flow will use to extend, as shown in the menu. */
  readonly model: string | null;
  /** Why Flow disabled extending, e.g. only Veo-generated clips can be extended. */
  readonly reason: string | null;
}

export type SceneAction = 'extend' | 'edit';
