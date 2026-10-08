import { assertAssetIndex } from '../../domain/asset.js';
import { InvalidInputError, PreconditionFailedError } from '../../domain/errors.js';
import { MANUAL_SUBMIT_STEP } from '../../domain/generation.js';
import type { PanelState } from '../../domain/generation.js';
import { Prompt } from '../../domain/prompt.js';
import type { ExtendAvailability, SceneAction, SceneSummary } from '../../domain/scene.js';
import type { FileVault, MediaGrid, SceneEditor } from '../ports.js';
import type { Quote, SpendGuard } from '../spend-guard.js';

const SAFE_FILE_NAME = /^[\w\-. ]{1,120}$/;

export interface SceneActionOutcome {
  status: 'prepared' | 'submitted' | 'awaiting_user_click';
  nextStep?: string;
  action: SceneAction;
  panel: PanelState;
  quote?: Quote;
  creditsCharged: number;
  budgetRemaining: number;
}

/** Scene builder: arrange clips, extend them, edit them with a prompt, export the cut. */
export class SceneUseCases {
  constructor(
    private readonly grid: MediaGrid,
    private readonly editor: SceneEditor,
    private readonly vault: FileVault,
    private readonly guard: SpendGuard,
  ) {}

  async open(sceneIndex: number): Promise<SceneSummary & { extend: ExtendAvailability }> {
    await this.grid.showScenes(true);
    const summary = await this.editor.open(assertAssetIndex(sceneIndex));
    return { ...summary, extend: await this.editor.extendAvailability() };
  }

  /**
   * Extends the open scene with a generated continuation, or edits its clip
   * with a prompt. Extending is refused up front when Flow disables it (only
   * Veo-generated clips can be extended).
   */
  async act(input: { action: SceneAction; prompt: string; confirm: boolean; quoteId?: string }): Promise<SceneActionOutcome> {
    const prompt = Prompt.create(input.prompt);
    const request = { action: input.action, prompt: prompt.text };
    const approval = { confirm: input.confirm, quoteId: input.quoteId, request };
    if (input.confirm) this.guard.verify(approval);
    if (input.action === 'extend') {
      const availability = await this.editor.extendAvailability();
      if (!availability.available) {
        throw new PreconditionFailedError(`Flow does not allow extending this scene: ${availability.reason ?? 'unknown reason'}.`);
      }
    }
    const panel = await this.editor.prepare(input.action, prompt);
    const credits = this.guard.priceOf(panel.creditCost);
    if (!input.confirm) {
      const quote = this.guard.quote(request, credits);
      return { status: 'prepared', action: input.action, panel, quote, creditsCharged: 0, budgetRemaining: this.guard.remaining };
    }
    const { result, creditsCharged } = await this.guard.spend(`scene ${input.action}`, credits, approval, () => this.editor.submit());
    const handed = result === 'handed-to-user';
    return {
      status: handed ? 'awaiting_user_click' : 'submitted',
      ...(handed ? { nextStep: MANUAL_SUBMIT_STEP.replace('then call flow_wait', 'then wait for the clip to finish in the scene') } : {}),
      action: input.action,
      panel,
      creditsCharged,
      budgetRemaining: this.guard.remaining,
    };
  }

  async download(fileName: string): Promise<{ savedTo: string }> {
    if (!SAFE_FILE_NAME.test(fileName) || fileName.startsWith('.')) {
      throw new InvalidInputError('fileName must be a plain name (letters, digits, space, dot, dash, underscore).');
    }
    const destination = await this.vault.reserveOutput(fileName.toLowerCase().endsWith('.mp4') ? fileName : `${fileName}.mp4`);
    try {
      await this.editor.download(destination);
    } catch (error) {
      await this.vault.discard(destination);
      throw error;
    }
    return { savedTo: destination };
  }

  close(): Promise<void> {
    return this.editor.close();
  }
}
