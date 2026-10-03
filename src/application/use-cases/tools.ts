import { NotFoundError } from '../../domain/errors.js';
import { toolActionMaySpend, toolControlId, toolInput, toolName } from '../../domain/tools.js';
import type { OpenedTool, ToolControl, ToolSource, ToolSummary } from '../../domain/tools.js';
import type { ToolHost } from '../ports.js';
import type { Quote, SpendGuard } from '../spend-guard.js';

/**
 * Drives any Flow tool (Grid Architect, Stringout Creator, Storyboard Studio,
 * community tools...) generically: list its controls, fill them, click them.
 * Tools show no price, so a click that sounds like it produces media is
 * charged the conservative estimate and needs confirm=true.
 */
export class ToolUseCases {
  constructor(
    private readonly host: ToolHost,
    private readonly guard: SpendGuard,
  ) {}

  list(source: ToolSource): Promise<ToolSummary[]> {
    return this.host.list(source);
  }

  open(name: string): Promise<OpenedTool> {
    return this.host.open(toolName(name));
  }

  controls(): Promise<ToolControl[]> {
    return this.host.controls();
  }

  async fill(controlId: number, value: string): Promise<ToolControl[]> {
    await this.host.fill(toolControlId(controlId), toolInput(value));
    return this.host.controls();
  }

  /**
   * Clicks a control. A paid-looking button is not clicked on the first call:
   * it returns a quote, and the click happens on a second call with
   * confirm=true and that quote_id.
   */
  async click(input: { controlId: number; confirm: boolean; quoteId?: string }): Promise<
    { status: 'quoted'; label: string; quote: Quote } | { status: 'clicked'; label: string; creditsCharged: number; controls: ToolControl[] }
  > {
    const control = (await this.host.controls()).find((c) => c.id === toolControlId(input.controlId));
    if (!control) throw new NotFoundError(`No control ${input.controlId}. Call flow_tool_controls again; ids change as the tool re-renders.`);

    const credits = toolActionMaySpend(control.label) ? this.guard.priceOf(null) : 0;
    const request = { tool: 'click', label: control.label };
    if (credits > 0 && !input.confirm) {
      return { status: 'quoted', label: control.label, quote: this.guard.quote(request, credits) };
    }
    const { creditsCharged } = await this.guard.spend(`tool click "${control.label}"`, credits, { confirm: input.confirm, quoteId: input.quoteId, request }, () =>
      this.host.click(control.id),
    );
    return { status: 'clicked', label: control.label, creditsCharged, controls: await this.host.controls() };
  }

  close(): Promise<void> {
    return this.host.close();
  }
}
