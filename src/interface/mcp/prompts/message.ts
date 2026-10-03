import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

export function message(text: string): GetPromptResult {
  return { messages: [{ role: 'user', content: { type: 'text', text } }] };
}
