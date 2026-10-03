import { z } from 'zod';
import type { ToolUseCases } from '../../../application/use-cases/tools.js';
import { TOOL_SOURCES } from '../../../domain/tools.js';
import { defineTool, type ToolRuntime } from '../define-tool.js';
import { approval } from '../schemas.js';
import { ok } from '../tool-result.js';

const controlId = z.number().int().min(0).max(500).describe('Control id from the latest flow_tool_controls listing.');

export function registerToolHostTools(rt: ToolRuntime, tools: ToolUseCases): void {
  defineTool(rt, 'flow_tool_list', {
    description: 'Lists Flow tools (mini-apps): "mine" (your copies), "templates" (by Google: Grid Architect, Stringout Creator, Storyboard Studio, Video Resizer...) or "community".',
    input: { source: z.enum(TOOL_SOURCES).default('templates') },
    readOnly: true,
  }, async (a) => ok(await tools.list(a.source)));

  defineTool(rt, 'flow_tool_open', {
    description: 'Opens a tool by name and lists its controls. Reuses your copy when one exists; opening a template for the first time creates a copy in "mine" (reported as createdCopy).',
    input: { name: z.string().min(1).max(80) },
  }, async (a) => ok(await tools.open(a.name)));

  defineTool(rt, 'flow_tool_controls', {
    description: 'Re-reads the open tool\'s controls. Ids change whenever the tool re-renders, so call this before filling or clicking.',
    readOnly: true,
  }, async () => ok(await tools.controls()));

  defineTool(rt, 'flow_tool_fill', {
    description: 'Types a value into a text control, or selects an option of a choice control, in the open tool.',
    input: { control_id: controlId, value: z.string().max(4000) },
  }, async (a) => ok({ controls: await tools.fill(a.control_id, a.value) }));

  defineTool(rt, 'flow_tool_click', {
    description: 'Clicks a control in the open tool. Buttons that sound like they produce media (generate, render, create...) are treated as paid: the first call only returns a quote, the click needs confirm=true and its quote_id.',
    input: { control_id: controlId, ...approval },
  }, async (a) => ok(await tools.click({ controlId: a.control_id, confirm: a.confirm, ...(a.quote_id ? { quoteId: a.quote_id } : {}) })));

  defineTool(rt, 'flow_tool_close', {
    description: 'Leaves the open tool and returns to the project grid.',
  }, async () => {
    await tools.close();
    return ok({ closed: true });
  });
}
