import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ANGLES, describeImageTask, IMAGE_TASK_IDS, imageTipsFor } from '../../../domain/image-tasks.js';
import type { ImageTaskId } from '../../../domain/image-tasks.js';
import { message } from './message.js';

const TITLES: Record<ImageTaskId, string> = {
  avatar: 'Create an avatar',
  'identity-sheet': 'Identity sheet',
  'outfit-background': 'Change outfit or background',
  look: 'Change appearance',
  angle: 'New camera angle',
  'product-in-hand': 'Product in hand',
  'app-screen': 'App on the phone screen',
  'before-after': 'Before and after',
  'swap-person': 'Swap the person',
};

/**
 * Guided image jobs: the base image is what every video clip is animated
 * from, so each variation keeps the same face and changes one thing only.
 */
export function registerImagePrompts(server: McpServer): void {
  for (const task of IMAGE_TASK_IDS) {
    const info = describeImageTask(task);
    server.registerPrompt(
      `image_${task.replace(/-/g, '_')}`,
      { title: TITLES[task], description: info.summary, argsSchema: { details: z.string().optional().describe('What you want, in your own words.') } },
      (a) =>
        message(
          [
            `Help the user with this image job: ${TITLES[task]}. ${info.summary}`,
            a.details ? `The user said: ${a.details}` : '',
            'Talk to the user in their own language; ask one thing at a time.',
            '',
            'Step 1 — make sure a Flow project is open (flow_session_info, then flow_new_project or flow_open_project).',
            info.attach.length
              ? `Step 2 — references, in this order: ${info.attach.join('; ')}. Ask for each file and flow_upload it, or pick an existing one with flow_find_resources. Note each library name.`
              : 'Step 2 — no reference needed.',
            `Step 3 — collect: ${info.needs.join('; ')}.${task === 'angle' ? ` Angles: ${Object.keys(ANGLES).join(', ')}.` : ''}`,
            `Step 4 — call flow_image_prompt with task "${task}" and those details. It returns the prompt(s), what to attach and the aspect.`,
            'Step 5 — for each prompt: flow_generate with mode "image", that aspect, attach_resources in the returned order, variants 2, confirm=false. Show the price, and after the user agrees call again with confirm=true and the quote_id. Then flow_wait.',
            'Step 6 — show the results (flow_download), let the user pick one, and tell them its library name (flow_find_resources) so it can be used as a base_image or reference.',
            '',
            'Tips:',
            ...imageTipsFor(task).map((tip) => `- ${tip}`),
            'Never pass confirm=true without a quote the user has seen and accepted.',
          ]
            .filter(Boolean)
            .join('\n'),
        ),
    );
  }
}
