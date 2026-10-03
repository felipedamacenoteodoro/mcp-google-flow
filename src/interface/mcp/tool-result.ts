import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from '../../application/ports.js';
import { DomainError, RateLimitedError } from '../../domain/errors.js';
import type { Mutex } from '../../infrastructure/system/mutex.js';

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/**
 * Runs a tool body exclusively and converts failures into MCP errors.
 * Domain errors carry an actionable code; anything else is logged and
 * reported generically so stack traces and local paths never reach the agent.
 */
export function toolHandler<A>(mutex: Mutex, logger: Logger, name: string, body: (args: A) => Promise<CallToolResult>) {
  return (args: A): Promise<CallToolResult> =>
    mutex.run(async () => {
      try {
        return await body(args);
      } catch (error) {
        if (error instanceof DomainError) {
          const extra = error instanceof RateLimitedError ? { retryAfterMs: error.retryAfterMs } : {};
          return fail({ error: error.code, message: error.message, ...extra });
        }
        logger.error('tool failed', { tool: name, error: String(error) });
        return fail({ error: 'INTERNAL', message: `${name} failed unexpectedly. See the server log.` });
      }
    });
}

function fail(payload: Record<string, unknown>): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}
