import { InvalidInputError } from '../../domain/errors.js';
import { MANUAL_SUBMIT_STEP } from '../../domain/generation.js';
import type { PanelState } from '../../domain/generation.js';
import { Prompt } from '../../domain/prompt.js';
import type { CharacterStudio } from '../ports.js';
import type { Quote, SpendGuard } from '../spend-guard.js';

export interface CharacterOutcome {
  status: 'prepared' | 'submitted' | 'awaiting_user_click';
  nextStep?: string;
  panel: PanelState;
  quote?: Quote;
  creditsCharged: number;
  budgetRemaining: number;
}

/**
 * Characters are reusable people/creatures kept in the project. Once created
 * they show up in the resource picker and can be attached to any video.
 */
export class CharacterUseCases {
  constructor(
    private readonly studio: CharacterStudio,
    private readonly guard: SpendGuard,
  ) {}

  presets(): Promise<{ presets: string[]; model: string }> {
    return this.studio.open();
  }

  async create(input: { prompt: string; preset?: string; model?: string; confirm: boolean; quoteId?: string }): Promise<CharacterOutcome> {
    const prompt = Prompt.create(input.prompt);
    if (input.preset !== undefined && input.preset.trim().length === 0) {
      throw new InvalidInputError('preset must be a name from flow_character_presets.');
    }
    const request = { prompt: prompt.text, preset: input.preset?.trim() ?? null, model: input.model?.trim() ?? null };
    const approval = { confirm: input.confirm, quoteId: input.quoteId, request };
    if (input.confirm) this.guard.verify(approval);

    await this.studio.open();
    const panel = await this.studio.prepare({
      prompt,
      ...(input.preset ? { preset: input.preset.trim() } : {}),
      ...(input.model ? { model: input.model.trim() } : {}),
    });

    const credits = this.guard.priceOf(panel.creditCost);
    if (!input.confirm) {
      return { status: 'prepared', panel, quote: this.guard.quote(request, credits), creditsCharged: 0, budgetRemaining: this.guard.remaining };
    }
    const { result, creditsCharged } = await this.guard.spend('create character', credits, approval, async () => {
      const submitted = await this.studio.submit();
      // In manual mode the user still has to click on this page, so stay on it.
      if (submitted === 'clicked') await this.studio.leave();
      return submitted;
    });
    const handed = result === 'handed-to-user';
    return {
      status: handed ? 'awaiting_user_click' : 'submitted',
      ...(handed ? { nextStep: MANUAL_SUBMIT_STEP.replace('then call flow_wait', 'then call flow_find_resources with category "characters"') } : {}),
      panel,
      creditsCharged,
      budgetRemaining: this.guard.remaining,
    };
  }
}
