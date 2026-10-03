import { z } from 'zod';
import type { CharacterUseCases } from '../../../application/use-cases/characters.js';
import type { LibraryUseCases } from '../../../application/use-cases/library.js';
import { defineTool, type ToolRuntime } from '../define-tool.js';
import { category, approval, prompt, resourceName } from '../schemas.js';
import { ok } from '../tool-result.js';

export function registerLibraryTools(rt: ToolRuntime, library: LibraryUseCases, characters: CharacterUseCases): void {
  defineTool(rt, 'flow_find_resources', {
    description: 'Searches the resources the composer can reference by name ("@name"): images, videos, voices, characters, avatars, uploads.',
    input: { query: z.string().max(120).optional(), category },
    readOnly: true,
  }, async (a) => ok(await library.search(a.query, a.category)));

  defineTool(rt, 'flow_character_presets', {
    description: 'Opens the character page and lists its preset archetypes and the image model in use.',
    readOnly: true,
  }, async () => ok(await characters.presets()));

  defineTool(rt, 'flow_create_character', {
    description:
      'Creates a reusable character from a description, optionally starting from a preset. Once created it can be attached to any video with attach_resources. confirm=false prepares and quotes; confirm=true plus quote_id creates it.',
    input: { prompt, preset: z.string().max(80).optional(), model: z.string().max(60).optional(), ...approval },
  }, async (a) =>
    ok(
      await characters.create({
        prompt: a.prompt,
        ...(a.preset ? { preset: a.preset } : {}),
        ...(a.model ? { model: a.model } : {}),
        confirm: a.confirm,
        ...(a.quote_id ? { quoteId: a.quote_id } : {}),
      }),
    ));

  // Kept separate from flow_generate for agents that attach step by step.
  defineTool(rt, 'flow_attach_resource', {
    description: 'Attaches one named resource to the composer. Prefer attach_resources on flow_generate, which clears the composer first.',
    input: { name: resourceName, category },
  }, async (a) => ok(await library.attach(a.name, a.category)));
}
