import { readFile } from 'node:fs/promises';
import { z } from 'zod';

/**
 * Every piece of Flow UI text the adapters depend on, in one place. Flow
 * changes wording and language without notice; users fix that with a JSON
 * override (FLOW_MCP_UI_LABELS) instead of patching code.
 *
 * Defaults match the Portuguese UI as inspected on 2026-09-29, except where a
 * value is marked UNVERIFIED. Strings used as patterns are regular expressions.
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
  newProject: 'New project|Novo projeto',
  openProjectLink: 'Abrir projeto',
  signedOutPath: '/about',
  agentToggle: 'Agente',

  addFilesMenu: 'Menu para adicionar arquivos',
  uploadAction: 'Enviar',
  acceptRights: 'Concordo',
  tileMenu: 'Mais opções',
  menuAddToScene: 'Adicionar ao cenário',
  menuNewScene: 'Nova cena',
  menuIncludeInComposer: 'Incluir no comando',
  menuDownload: 'Fazer o download',
  failedTile: '^(warning\\s+)?(Falha|Failed)\\b',
  navAllMedia: 'Todas as mídias',
  navScenes: 'Cenas',
  quality: { standard: '720p|Tamanho original|Original size', '1080p': '1080p', '4k': '4K' },

  settingsTrigger: 'Gatilho de configurações',
  modeImage: 'Imagem',
  modeVideo: 'Vídeo',
  videoInputFrames: 'Frames',
  videoInputElements: 'Elementos',
  modelFamily: 'Selecionar família de modelos',
  creditCost: '(\\d+)\\s*(?:créditos?|credits?)',
  addElements: 'Adicionar elementos à caixa de comando',
  frameStart: 'Início',
  frameEnd: 'Fim',
  referenceAltPrefix: 'Imagem do elemento',
  referenceVideoMarker: 'vídeo',
  clearComposer: 'Apagar comando',
  submit: 'Iniciar geração',

  pickerSearch: 'Pesquisar recursos',
  pickerInclude: 'Incluir no comando',
  pickerTabs: {
    all: 'Tudo',
    images: 'Imagens',
    videos: 'Vídeos',
    voices: 'Vozes',
    characters: 'Personagens',
    avatars: 'Avatares',
    uploads: 'Envios',
  },

  characterPath: '/character',
  back: 'Voltar',

  addClip: 'Adicionar clipe',
  extendItem: 'Estender',
  downloadScene: 'Baixar cena',
  sceneDone: 'Edição da cena concluída',

  toolsPath: '/tools',
  toolTabs: { mine: 'Minhas ferramentas', community: 'Comunidade', templates: 'Modelos' },
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
