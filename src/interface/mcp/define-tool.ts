import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Logger } from '../../application/ports.js';
import type { Mutex } from '../../infrastructure/system/mutex.js';
import { toolHandler } from './tool-result.js';

export interface ToolRuntime {
  server: McpServer;
  mutex: Mutex;
  logger: Logger;
}

interface ToolConfig<S extends z.ZodRawShape> {
  description: string;
  input?: S;
  readOnly?: boolean;
}

/** Registers one tool with typed arguments inferred from its schema, run exclusively. */
export function defineTool<S extends z.ZodRawShape>(
  runtime: ToolRuntime,
  name: string,
  config: ToolConfig<S>,
  body: (args: z.infer<z.ZodObject<S>>) => Promise<CallToolResult>,
): void {
  const handler = toolHandler<z.infer<z.ZodObject<S>>>(runtime.mutex, runtime.logger, name, body);
  runtime.server.registerTool(
    name,
    {
      description: config.description,
      ...(config.input ? { inputSchema: config.input } : {}),
      ...(config.readOnly ? { annotations: { readOnlyHint: true } } : {}),
    },
    handler as never,
  );
}
