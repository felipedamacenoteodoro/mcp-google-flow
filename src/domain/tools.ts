import { InvalidInputError } from './errors.js';

/**
 * Flow "tools" are mini-apps (applets) that run sandboxed inside a project:
 * Google templates such as Grid Architect or Stringout Creator, community
 * tools, and the user's own copies. Opening a template creates a personal
 * copy ("remix"), so the user's copy is always preferred when one exists.
 */
export const TOOL_SOURCES = ['mine', 'community', 'templates'] as const;
export type ToolSource = (typeof TOOL_SOURCES)[number];

export interface ToolSummary {
  readonly name: string;
  readonly author: string;
  readonly description: string;
}

export type ToolControlKind = 'button' | 'text' | 'choice';

/** A control inside an open tool. `id` is its position in the latest control listing. */
export interface ToolControl {
  readonly id: number;
  readonly kind: ToolControlKind;
  readonly label: string;
  /** Current content of text and choice controls, so a fill can be verified. */
  readonly value?: string;
}

export interface OpenedTool {
  readonly name: string;
  readonly createdCopy: boolean;
  readonly controls: ToolControl[];
}

// Tools are arbitrary third-party UIs, so there is no price tag to read.
// Any button that sounds like it produces media is treated as paid.
const PAID_ACTION = /generat|gerar|render|creat|criar|architect|run\b|execut|start|iniciar|produc|animat|upscal|extend|estend|transform/i;

export function toolActionMaySpend(label: string): boolean {
  return PAID_ACTION.test(label);
}

export function toolName(raw: string): string {
  const value = raw.trim();
  if (value.length === 0 || value.length > 80) {
    throw new InvalidInputError('Tool names must have 1 to 80 characters.');
  }
  return value;
}

export function toolControlId(id: number): number {
  if (!Number.isInteger(id) || id < 0 || id > 500) {
    throw new InvalidInputError('Control id must be an integer from the latest flow_tool_controls listing.');
  }
  return id;
}

export function toolInput(raw: string): string {
  const value = raw.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  if (value.length > 4000) throw new InvalidInputError('Tool input is limited to 4000 characters.');
  return value;
}
