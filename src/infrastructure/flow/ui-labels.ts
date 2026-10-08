import { readFile } from 'node:fs/promises';
import { z } from 'zod';

/**
 * Every piece of Flow UI text the adapters depend on, in one place. Flow
 * changes wording and language without notice; users fix that with a JSON
 * override (FLOW_MCP_UI_LABELS) instead of patching code.
 *
 * Each label lists its alternatives separated by "|", so the same build works
 * with Flow in Portuguese or English (and any language added through the
 * override). Checked against both languages on 2026-10-08, except values
 * marked "EN unverified". A few fields are regular expressions (newProject,
 * failedTile, creditCost, quality); those say so next to their schema entry.
 */
const schema = z
  .object({
    // Home and project shell
    newProject: z.string(), //            pattern; the home button is in English
    openProjectLink: z.string(), //       aria-label of each project card link
    signedOutPath: z.string(),
    agentToggle: z.string(),
    // Project grid
    addFilesMenu: z.string(), //          aria-label
    uploadAction: z.string(),
    acceptRights: z.string(),
    tileMenu: z.string(), //              aria-label
    menuAddToScene: z.string(),
    menuNewScene: z.string(),
    menuIncludeInComposer: z.string(),
    menuDownload: z.string(),
    failedTile: z.string(), //            pattern matching the first words of a failed generation tile
    navAllMedia: z.string(),
    navScenes: z.string(),
    quality: z.object({ standard: z.string(), '1080p': z.string(), '4k': z.string() }), // 1080p/4k UNVERIFIED
    // Composer and settings panel
    settingsTrigger: z.string(), //       aria-label
    modeImage: z.string(),
    modeVideo: z.string(),
    videoInputFrames: z.string(),
    videoInputElements: z.string(),
    modelFamily: z.string(), //           aria-label
    creditCost: z.string(), //            pattern with one capture group for the number
    addElements: z.string(), //           aria-label of the composer "+" button
    frameStart: z.string(),
    frameEnd: z.string(),
    referenceAltPrefix: z.string(),
    referenceVideoMarker: z.string(),
    clearComposer: z.string(), //         aria-label, UNVERIFIED on the current UI
    submit: z.string(), //                aria-label
    // Resource picker
    pickerSearch: z.string(), //          aria-label
    pickerInclude: z.string(),
    pickerTabs: z.object({
      all: z.string(),
      images: z.string(),
      videos: z.string(),
      voices: z.string(),
      characters: z.string(),
      avatars: z.string(),
      uploads: z.string(),
    }),
    // Characters page
    characterPath: z.string(),
    back: z.string(), //                  pattern for the back buttons
    // Scene builder
    addClip: z.string(), //               aria-label
    extendItem: z.string(), //            pattern; the model name follows in parentheses
    downloadScene: z.string(), //         aria-label
    sceneDone: z.string(), //             aria-label
    // Tools
    toolsPath: z.string(),
    toolTabs: z.object({ mine: z.string(), community: z.string(), templates: z.string() }),
    toolFrameHost: z.string(), //         host suffix of the sandboxed tool iframe
    remixPrefix: z.string(),
  })
  .strict();

export type FlowUiLabels = z.infer<typeof schema>;

export const DEFAULT_LABELS: FlowUiLabels = {
  newProject: 'Novo projeto|New project',
  openProjectLink: 'Abrir projeto|Open project',
  signedOutPath: '/about',
  agentToggle: 'Agente|Agent',

  addFilesMenu: 'Menu para adicionar arquivos|Add media menu',
  uploadAction: 'Enviar|Upload',
  acceptRights: 'Concordo|I agree', //                                EN unverified
  tileMenu: 'Mais opções|More options',
  menuAddToScene: 'Adicionar ao cenário|Add to scene', //             EN unverified
  menuNewScene: 'Nova cena|New scene',
  menuIncludeInComposer: 'Incluir no comando|Add to prompt',
  menuDownload: 'Fazer o download|Download',
  failedTile: '^(warning\\s+)?(Falha|Failed)\\b',
  navAllMedia: 'Todas as mídias|All media',
  navScenes: 'Cenas|Scenes',
  quality: {
    standard: '720p|Tamanho original|Original size',
    '1080p': '1080p|2K',
    '4k': '4K',
  },

  settingsTrigger: 'Gatilho de configurações|Settings trigger',
  modeImage: 'Imagem|Image',
  modeVideo: 'Vídeo|Video',
  videoInputFrames: 'Frames',
  videoInputElements: 'Elementos|Ingredients',
  modelFamily: 'Selecionar família de modelos|Select model family',
  creditCost: '(\\d+)\\s*(?:créditos?|credits?)',
  addElements: 'Adicionar elementos à caixa de comando|Add ingredients to the prompt box',
  frameStart: 'Início|Start',
  frameEnd: 'Fim|End',
  referenceAltPrefix: 'Imagem do elemento|Ingredient image',
  referenceVideoMarker: 'vídeo|video',
  clearComposer: 'Apagar comando|Clear prompt',
  submit: 'Iniciar geração|Start generation',

  pickerSearch: 'Pesquisar recursos|Search assets',
  pickerInclude: 'Incluir no comando|Add to prompt',
  pickerTabs: {
    all: 'Tudo|All',
    images: 'Imagens|Images',
    videos: 'Vídeos|Videos',
    voices: 'Vozes|Voices',
    characters: 'Personagens|Characters',
    avatars: 'Avatares|Avatars',
    uploads: 'Envios|Uploads',
  },

  characterPath: '/character',
  back: 'Voltar|Go back',

  addClip: 'Adicionar clipe|Add clip', //                             EN unverified
  extendItem: 'Estender|Extend', //                                   EN unverified
  downloadScene: 'Baixar cena|Download scene', //                     EN unverified
  sceneDone: 'Edição da cena concluída|Done editing scene', //        EN unverified

  toolsPath: '/tools',
  toolTabs: { mine: 'Minhas ferramentas|My Tools', community: 'Comunidade|Community', templates: 'Modelos|Templates' },
  toolFrameHost: '.usercontent.goog',
  remixPrefix: 'Remix of ',
};

// Every override key may be partial; unknown keys are rejected so a typo fails loudly.
const overrideSchema = schema
  .partial()
  .extend({
    quality: schema.shape.quality.partial().optional(),
    pickerTabs: schema.shape.pickerTabs.partial().optional(),
    toolTabs: schema.shape.toolTabs.partial().optional(),
  })
  .strict();

/** Defaults merged with an optional partial JSON override file. */
export async function loadLabels(overridePath?: string): Promise<FlowUiLabels> {
  if (!overridePath) return DEFAULT_LABELS;
  const partial = overrideSchema.parse(JSON.parse(await readFile(overridePath, 'utf8')));
  const merged: FlowUiLabels = {
    ...DEFAULT_LABELS,
    ...partial,
    quality: { ...DEFAULT_LABELS.quality, ...partial.quality },
    pickerTabs: { ...DEFAULT_LABELS.pickerTabs, ...partial.pickerTabs },
    toolTabs: { ...DEFAULT_LABELS.toolTabs, ...partial.toolTabs },
  };
  new RegExp(merged.creditCost);
  new RegExp(merged.newProject);
  return merged;
}
