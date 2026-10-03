import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { message } from './message.js';

/** Supporting commands: writing the script and designing a consistent voice. */
export function registerHelperPrompts(server: McpServer): void {
  server.registerPrompt(
    'script_write',
    {
      title: 'Write a video script',
      description: 'Writes a short ad or content script, one sentence per shot.',
      argsSchema: {
        topic: z.string().optional().describe('Product, offer or subject.'),
        format: z.string().optional().describe('The kind of video, e.g. selfie testimonial or two-person conversation.'),
      },
    },
    (a) =>
      message(
        [
          'Write a short video script with the user. Talk to them in their own language; ask one thing at a time.',
          a.topic ? `Topic: ${a.topic}.` : 'Ask what is being sold or explained, and to whom.',
          a.format ? `Format: ${a.format}.` : 'Ask what kind of video it is (e.g. one person talking to the camera, two people talking, narration over footage).',
          '',
          '1. Understand the audience: who they are, what they already believe, what stops them from acting.',
          '2. Propose three different angles (e.g. the pain it removes, a surprising fact, a before/after, social proof) and let the user choose one.',
          '3. Write the script in the language of the target audience:',
          '   - Line 1 is the hook: a question or claim that stops the scroll in two seconds.',
          '   - Then the problem, the turn (what changes), the proof, and a clear call to action.',
          '   - One sentence per line, about 18 words at most per line (one 8-second shot).',
          '   - Two-person formats: prefix each line with the speaker ("Ana: ..."). Mark the key line with a leading "*". Add at most one gesture in brackets at the start or end of a line, written in English ("[smiles]"), since the prompt is in English.',
          '   - Talking scripts stay short (about six lines); for longer ones suggest narration over footage.',
          '4. Read it back, adjust with the user, then offer to plan it with flow_plan_shots.',
          'Make only claims the user can back up; no invented numbers or testimonials.',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
  );

  server.registerPrompt(
    'voice_design',
    {
      title: 'Design a voice',
      description: 'Builds a voice description to repeat word for word in every clip of a character.',
      argsSchema: { character: z.string().optional().describe('Who the voice belongs to.') },
    },
    (a) =>
      message(
        [
          `Design a consistent voice${a.character ? ` for ${a.character}` : ''}. Talk to the user in their own language.`,
          'Ask, one at a time: gender; age bracket; pitch or weight (high, medium, low, deep); texture (smooth, gravelly, breathy, bright); delivery (calm, fast, warm, authoritative, playful).',
          'Comparing with a nearby age helps (e.g. "fuller and more settled than someone in their twenties").',
          'Then ask for the accent: language, city or region, and register (e.g. informal, like friends chatting); offer a neutral accent for broad audiences. A known sound of the accent makes it more reliable.',
          'Return the voice as one line, e.g. "Female voice, mid-30s, medium pitch, smooth, warm and confident." Tell the user to reuse it unchanged in flow_plan_shots, since rewording it changes the voice between clips.',
          'In two-person formats each person needs a clearly different voice.',
        ].join('\n'),
      ),
  );
}
