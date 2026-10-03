import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerHelperPrompts } from './helper-prompts.js';
import { registerImagePrompts } from './image-prompts.js';

/** Every guided command (shown as slash commands by clients that support MCP prompts). */
export function registerPrompts(server: McpServer): void {
  registerImagePrompts(server);
  registerHelperPrompts(server);
}
