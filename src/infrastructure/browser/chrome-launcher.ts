import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Clock } from '../../application/ports.js';
import { FlowUnavailableError } from '../../domain/errors.js';

const CANDIDATES: Record<string, string[]> = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'],
  win32: [
    `${process.env['PROGRAMFILES'] ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['LOCALAPPDATA'] ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
};

export function findChrome(override?: string): string {
  const path = override ?? CANDIDATES[process.platform]?.find((p) => existsSync(p));
  if (!path || !existsSync(path)) {
    throw new FlowUnavailableError('Google Chrome not found. Set FLOW_MCP_CHROME_PATH.');
  }
  return path;
}

/**
 * Starts the real Chrome on a DEDICATED profile directory (never the user's
 * everyday profile, and never a copy of it) with DevTools on a random port.
 * Chrome picks the port and writes it to DevToolsActivePort inside the profile,
 * so there is no fixed, guessable port to probe.
 */
export class ChromeLauncher {
  constructor(
    private readonly chromePath: string,
    private readonly profileDir: string,
    private readonly clock: Clock,
  ) {}

  /** Endpoint of a Chrome already running on the profile, if its port file exists. */
  async runningEndpoint(): Promise<string | null> {
    try {
      const [port] = (await readFile(this.portFile, 'utf8')).split('\n');
      return port && /^\d{2,5}$/.test(port) ? `http://127.0.0.1:${port}` : null;
    } catch {
      return null;
    }
  }

  async launch(): Promise<string> {
    await mkdir(this.profileDir, { recursive: true, mode: 0o700 });
    await chmod(this.profileDir, 0o700);
    await rm(this.portFile, { force: true });

    const child = spawn(
      this.chromePath,
      [
        `--user-data-dir=${this.profileDir}`,
        '--remote-debugging-port=0',
        '--no-first-run',
        '--no-default-browser-check',
        '--restore-last-session=false',
        'about:blank',
      ],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();

    const deadline = this.clock.now() + 20_000;
    while (this.clock.now() < deadline) {
      const endpoint = await this.runningEndpoint();
      if (endpoint) return endpoint;
      await this.clock.sleep(250);
    }
    throw new FlowUnavailableError('Chrome started but did not open a DevTools port within 20s.');
  }

  private get portFile(): string {
    return join(this.profileDir, 'DevToolsActivePort');
  }
}
