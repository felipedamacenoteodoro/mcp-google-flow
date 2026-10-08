import { assertAssetIndex } from '../../domain/asset.js';
import { InvalidInputError, PreconditionFailedError } from '../../domain/errors.js';
import { createGenerationSettings, MANUAL_SUBMIT_STEP, sameReferences } from '../../domain/generation.js';
import type {
  AspectRatio,
  GenerationMode,
  GenerationOptions,
  GenerationSettings,
  PanelState,
  ReferenceCount,
  SubmitMode,
  SubmitResult,
  VideoResolution,
} from '../../domain/generation.js';
import { resourceQuery } from '../../domain/library.js';
import { Prompt } from '../../domain/prompt.js';
import type { Composer, ResourceLibrary } from '../ports.js';
import type { Quote, SpendGuard } from '../spend-guard.js';

export interface SettingsInput {
  mode: GenerationMode;
  aspect: AspectRatio;
  variants?: number;
  model?: string;
  resolution?: VideoResolution;
  durationSeconds?: number;
}

export interface ShotInput {
  prompt: string;
  /** Frames mode: the image this shot is animated from. */
  startFrame?: string;
  /** Grid tiles to attach before writing the prompt. */
  attachIndices?: number[];
  /** Named resources (characters, voices, images, videos) to attach, like typing "@name". */
  attachResources?: string[];
}

export interface GenerationInput extends SettingsInput, ShotInput {
  /** Frames mode: resources for the first and last frame. */
  startFrame?: string;
  endFrame?: string;
  confirm: boolean;
  quoteId?: string;
}

export interface GenerationOutcome {
  /** awaiting_user_click: manual submit mode; the user clicks generate in the Flow window. */
  status: 'prepared' | 'submitted' | 'awaiting_user_click';
  /** What the agent should tell the user next, when there is something to do. */
  nextStep?: string;
  settings: GenerationSettings;
  panel: PanelState;
  references: ReferenceCount;
  /** Present when prepared: pass its quoteId with confirm=true to spend. */
  quote?: Quote;
  creditsCharged: number;
  budgetRemaining: number;
}

interface PreparedRequest {
  settings: GenerationSettings;
  panel: PanelState;
  references: ReferenceCount;
  credits: number;
}

const MAX_SHOTS = 20;

export class GenerationUseCases {
  constructor(
    private readonly composer: Composer,
    private readonly library: ResourceLibrary,
    private readonly guard: SpendGuard,
    private readonly submitMode: SubmitMode = 'auto',
  ) {}

  /** Live catalogue of modes, models, ratios, durations and the current price. */
  options(): Promise<GenerationOptions> {
    return this.composer.readOptions();
  }

  /**
   * First call (confirm=false): prepares the composer and returns Flow's price
   * with a quote. Second call (confirm=true + quote_id): prepares again and
   * submits, re-checking the attachments right before the click, since chips
   * can silently disappear and a submit without them wastes credits.
   */
  async generate(input: GenerationInput): Promise<GenerationOutcome> {
    const request = describeRequest(input);
    const approval = { confirm: input.confirm, quoteId: input.quoteId, request };
    if (input.confirm) this.guard.verify(approval);

    const prepared = await this.prepare(input);
    if (!input.confirm) return this.prepared(prepared, this.guard.quote(request, prepared.credits));

    const { result, creditsCharged } = await this.guard.spend(`generate ${prepared.settings.mode}`, prepared.credits, approval, () =>
      this.submitChecked(prepared.references),
    );
    return this.submitted(prepared, creditsCharged, result);
  }

  /**
   * A sequence of shots with shared settings. The first shot is prepared to
   * read the price; the quote covers the whole list, and the budget is checked
   * for all shots before the first one is submitted.
   */
  async runShotList(input: SettingsInput & { shots: ShotInput[]; confirm: boolean; quoteId?: string }): Promise<GenerationOutcome[]> {
    if (input.shots.length === 0 || input.shots.length > MAX_SHOTS) {
      throw new InvalidInputError(`A shot list must have between 1 and ${MAX_SHOTS} shots.`);
    }
    if (input.confirm && this.submitMode === 'manual') {
      throw new InvalidInputError(
        'Shot lists need automatic submits. In manual submit mode, generate one shot at a time with flow_generate and let the user click each one.',
      );
    }
    if (input.mode === 'frames' && input.shots.some((shot) => !shot.startFrame)) {
      throw new InvalidInputError('In frames mode every shot needs a startFrame (the base image).');
    }
    const settings = createGenerationSettings(input);
    const request = { settings, shots: input.shots.map((shot) => describeShot(shot)) };
    const approval = { confirm: input.confirm, quoteId: input.quoteId, request };
    if (input.confirm) this.guard.verify(approval);

    const first = await this.prepare({ ...input, ...input.shots[0]! });
    const total = first.credits * input.shots.length;
    if (!input.confirm) return [this.prepared(first, this.guard.quote(request, total))];

    this.guard.redeem(approval, total);
    const outcomes: GenerationOutcome[] = [];
    for (const [i, shot] of input.shots.entries()) {
      const prepared = i === 0 ? first : await this.prepare({ ...input, ...shot });
      const { creditsCharged } = await this.guard.charge(`shot ${i + 1}`, prepared.credits, () =>
        this.submitChecked(prepared.references),
      );
      outcomes.push(this.submitted(prepared, creditsCharged, 'clicked'));
    }
    return outcomes;
  }

  private async prepare(input: SettingsInput & ShotInput & { startFrame?: string; endFrame?: string }): Promise<PreparedRequest> {
    const settings = createGenerationSettings(input);
    const prompt = Prompt.create(input.prompt);
    validateFrames(settings, input);

    // Mode switches wipe attachments, so configure strictly before attaching.
    await this.composer.clear();
    await this.composer.configure(settings);
    for (const index of input.attachIndices ?? []) await this.composer.attachAsset(assertAssetIndex(index));
    for (const name of input.attachResources ?? []) await this.library.attach(resourceQuery(name), 'all');
    if (input.startFrame) await this.composer.setFrame('start', resourceQuery(input.startFrame));
    if (input.endFrame) await this.composer.setFrame('end', resourceQuery(input.endFrame));
    await this.composer.writePrompt(prompt);

    // Read the price once everything is in place: references can change it.
    const panel = await this.composer.panelState();
    const references = await this.composer.references();
    return { settings, panel, references, credits: this.guard.priceOf(panel.creditCost, settings.variants) };
  }

  private async submitChecked(expected: ReferenceCount): Promise<SubmitResult> {
    const atSubmit = await this.composer.references();
    if (!sameReferences(atSubmit, expected)) {
      throw new PreconditionFailedError(
        `Composer holds ${atSubmit.videos} video(s) and ${atSubmit.images} image(s); ` +
          `expected ${expected.videos} and ${expected.images}. Nothing was submitted.`,
      );
    }
    return this.composer.submit();
  }

  private prepared(p: PreparedRequest, quote: Quote): GenerationOutcome {
    return { status: 'prepared', settings: p.settings, panel: p.panel, references: p.references, quote, creditsCharged: 0, budgetRemaining: this.guard.remaining };
  }

  private submitted(p: PreparedRequest, creditsCharged: number, result: SubmitResult): GenerationOutcome {
    const handed = result === 'handed-to-user';
    return {
      status: handed ? 'awaiting_user_click' : 'submitted',
      ...(handed ? { nextStep: MANUAL_SUBMIT_STEP } : {}),
      settings: p.settings, panel: p.panel, references: p.references, creditsCharged, budgetRemaining: this.guard.remaining,
    };
  }
}

function describeShot(shot: ShotInput) {
  return {
    prompt: Prompt.create(shot.prompt).text,
    startFrame: shot.startFrame ?? null,
    attachIndices: shot.attachIndices ?? [],
    attachResources: shot.attachResources ?? [],
  };
}

function describeRequest(input: GenerationInput) {
  return {
    settings: createGenerationSettings(input),
    ...describeShot(input),
    endFrame: input.endFrame ?? null,
  };
}

function validateFrames(settings: GenerationSettings, input: { startFrame?: string; endFrame?: string }): void {
  const hasFrames = Boolean(input.startFrame || input.endFrame);
  if (settings.mode === 'frames' && !hasFrames) {
    throw new InvalidInputError('Frames mode needs startFrame, endFrame or both.');
  }
  if (settings.mode !== 'frames' && hasFrames) {
    throw new InvalidInputError('startFrame and endFrame apply only to frames mode.');
  }
}
