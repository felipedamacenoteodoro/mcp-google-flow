import { homedir } from 'node:os';
import type { Logger } from '../../application/ports.js';

const REDACTIONS: ReadonlyArray<[RegExp, string]> = [
  [/ya29\.[\w\-.]+/g, 'ya29.[redacted]'],
  [/AIza[\w\-]{30,}/g, 'AIza[redacted]'],
  [/[\w.+\-]+@[\w\-]+\.[\w.\-]+/g, '[email]'],
  [/(SID|SAPISID|PSID\w*|session-token)=[^;\s]+/gi, '$1=[redacted]'],
];

export function redact(text: string): string {
  let out = text.split(homedir()).join('~');
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * JSON lines on stderr. stdout belongs to the MCP stdio transport, and
 * anything written there would corrupt the protocol stream.
 */
export function createStderrLogger(): Logger {
  const write = (level: string, message: string, fields?: Record<string, unknown>) => {
    const line = JSON.stringify({ t: new Date().toISOString(), level, message, ...fields });
    process.stderr.write(`${redact(line)}\n`);
  };
  return {
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  };
}
