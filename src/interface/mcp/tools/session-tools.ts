import { z } from 'zod';
import type { SessionUseCases } from '../../../application/use-cases/session.js';
import type { SpendGuard } from '../../../application/spend-guard.js';
import { defineTool, type ToolRuntime } from '../define-tool.js';
import { ok } from '../tool-result.js';

export function registerSessionTools(rt: ToolRuntime, session: SessionUseCases, guard: SpendGuard): void {
  defineTool(rt, 'flow_session_info', {
    description: 'Browser connection, sign-in state, current URL and remaining credit budget. Never launches Chrome.',
    readOnly: true,
  }, async () => ok({ ...(await session.status()), creditBudgetRemaining: guard.remaining, creditBudgetLimit: guard.limit }));

  defineTool(rt, 'flow_sign_in', {
    description:
      'Opens Flow so the USER signs in by hand. With the dedicated profile it opens a plain Chrome window with no automation attached, because Google refuses sign-in in automated browsers. The server never sees or types credentials.',
  }, async () => {
    const mode = await session.signIn();
    return ok({
      message:
        mode === 'plain-window'
          ? 'A normal Chrome window is open on Flow. Ask the user to sign in there and then QUIT that Chrome completely (Cmd+Q on Mac, close every window on Windows/Linux). After that, any Flow tool reopens the same profile, already signed in.'
          : 'Flow is open in your Chrome. Ask the user to sign in there, then call flow_session_info.',
    });
  });

  defineTool(rt, 'flow_list_projects', {
    description: 'Lists projects, newest first. Flow loads them as the page scrolls, so large limits take longer.',
    input: { limit: z.number().int().min(1).max(1000).default(50) },
    readOnly: true,
  }, async ({ limit }) => ok(await session.listProjects(limit)));

  defineTool(rt, 'flow_new_project', {
    description: 'Creates a new project, turns the prompt-rewriting agent off, and returns its URL.',
  }, async () => ok(await session.newProject()));

  defineTool(rt, 'flow_open_project', {
    description: 'Opens a project. Only https://flow.google.com URLs are accepted.',
    input: { url: z.string().url() },
  }, async ({ url }) => {
    await session.openProject(url);
    return ok({ opened: true });
  });

  defineTool(rt, 'flow_capture_screen', {
    description: 'Screenshot of the Flow page, for debugging a stuck step. It may show the signed-in account.',
    readOnly: true,
  }, async () => ({ content: [{ type: 'image', mimeType: 'image/jpeg', data: (await session.screenshot()).toString('base64') }] }));
}
