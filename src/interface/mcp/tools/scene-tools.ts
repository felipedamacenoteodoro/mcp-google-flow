import type { SceneUseCases } from '../../../application/use-cases/scenes.js';
import { defineTool, type ToolRuntime } from '../define-tool.js';
import { approval, fileName, prompt, tileIndex } from '../schemas.js';
import { ok } from '../tool-result.js';

export function registerSceneTools(rt: ToolRuntime, scenes: SceneUseCases): void {
  defineTool(rt, 'flow_scene_open', {
    description: 'Opens a scene (index from flow_list_assets with scenes_only=true) and reports its clips and whether it can be extended.',
    input: { index: tileIndex },
  }, async ({ index }) => ok(await scenes.open(index)));

  defineTool(rt, 'flow_scene_extend', {
    description: 'Extends the open scene with a generated continuation described by the prompt. Only Veo-generated clips can be extended. confirm=false prepares and shows the price.',
    input: { prompt, ...approval },
  }, async (a) => ok(await scenes.act({ action: 'extend', prompt: a.prompt, confirm: a.confirm, ...(a.quote_id ? { quoteId: a.quote_id } : {}) })));

  defineTool(rt, 'flow_scene_edit', {
    description: 'Edits the selected clip of the open scene with a prompt ("make it night", "remove the logo"). confirm=false prepares and shows the price.',
    input: { prompt, ...approval },
  }, async (a) => ok(await scenes.act({ action: 'edit', prompt: a.prompt, confirm: a.confirm, ...(a.quote_id ? { quoteId: a.quote_id } : {}) })));

  defineTool(rt, 'flow_scene_download', {
    description: 'Exports the whole scene timeline as one video into the output folder (free export).',
    input: { file_name: fileName },
  }, async (a) => ok(await scenes.download(a.file_name)));

  defineTool(rt, 'flow_scene_close', {
    description: 'Leaves the scene builder and returns to the project grid.',
  }, async () => {
    await scenes.close();
    return ok({ closed: true });
  });
}
