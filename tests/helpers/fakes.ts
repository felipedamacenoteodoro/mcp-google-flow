import type {
  CharacterStudio,
  Clock,
  Composer,
  FileVault,
  Logger,
  MediaGrid,
  RateLimiter,
  ResourceLibrary,
  SceneEditor,
  ToolHost,
  VerifiedFile,
} from '../../src/application/ports.js';
import { SpendGuard } from '../../src/application/spend-guard.js';
import type { Asset, DownloadQuality } from '../../src/domain/asset.js';
import type { GenerationOptions, GenerationSettings, PanelState, ReferenceCount } from '../../src/domain/generation.js';
import type { Resource, ResourceCategory } from '../../src/domain/library.js';
import type { Prompt } from '../../src/domain/prompt.js';
import type { ExtendAvailability, SceneAction, SceneSummary } from '../../src/domain/scene.js';
import { SpendLedger } from '../../src/domain/spend-ledger.js';
import type { OpenedTool, ToolControl, ToolSource, ToolSummary } from '../../src/domain/tools.js';

/** Shared call log so tests can assert what was (not) clicked, in order. */
export class CallLog {
  calls: string[] = [];
  push(call: string) {
    this.calls.push(call);
  }
  count(call: string) {
    return this.calls.filter((c) => c === call).length;
  }
}

export class FakeComposer implements Composer {
  attached: ReferenceCount = { videos: 0, images: 0 };
  /** Scripted answers for successive reference checks (e.g. chips vanishing before submit). */
  scriptedReferences: ReferenceCount[] = [];
  price: number | null = 12;

  constructor(private readonly log: CallLog) {}

  async readOptions(): Promise<GenerationOptions> {
    return { modes: [], aspects: [], resolutions: [], durations: [], variants: [], models: [], current: await this.panelState() };
  }
  async configure(settings: GenerationSettings) {
    this.log.push(`configure ${settings.mode}`);
    return this.panelState();
  }
  async panelState(): Promise<PanelState> {
    return { summary: 'Video · 720p · 8s', creditCost: this.price };
  }
  async attachAsset(index: number) {
    this.log.push(`attach ${index}`);
    this.attached = { ...this.attached, images: this.attached.images + 1 };
  }
  async setFrame(slot: 'start' | 'end', name: string) {
    this.log.push(`frame ${slot} ${name}`);
  }
  async clear() {
    this.log.push('clear');
    this.attached = { videos: 0, images: 0 };
  }
  async references() {
    return this.scriptedReferences.shift() ?? this.attached;
  }
  async writePrompt(_prompt: Prompt) {
    this.log.push('writePrompt');
  }
  async submit() {
    this.log.push('submit');
  }
}

export class FakeLibrary implements ResourceLibrary {
  constructor(
    private readonly log: CallLog,
    private readonly composer?: FakeComposer,
  ) {}
  async search(query: string, _category: ResourceCategory): Promise<Resource[]> {
    return [{ name: query || 'any', kind: 'Imagem' }];
  }
  async attach(name: string): Promise<Resource> {
    this.log.push(`attach resource ${name}`);
    if (this.composer) this.composer.attached = { ...this.composer.attached, images: this.composer.attached.images + 1 };
    return { name, kind: 'Personagem' };
  }
}

export class FakeGrid implements MediaGrid {
  assets: Asset[] = [];
  scenesOnly = false;
  downloads: { index: number; quality: DownloadQuality; destination: string }[] = [];
  constructor(private readonly log: CallLog) {}
  async listAssets() {
    return this.assets;
  }
  async showScenes(onlyScenes: boolean) {
    this.scenesOnly = onlyScenes;
  }
  async upload(file: VerifiedFile) {
    this.log.push(`upload ${file.absolutePath}`);
  }
  async addToScene(index: number) {
    this.log.push(`addToScene ${index}`);
  }
  async download(index: number, quality: DownloadQuality, destination: string) {
    this.downloads.push({ index, quality, destination });
  }
}

export class FakeSceneEditor implements SceneEditor {
  availability: ExtendAvailability = { available: true, model: 'Veo 3.1 - Lite', reason: null };
  constructor(private readonly log: CallLog) {}
  async open(): Promise<SceneSummary> {
    return { url: 'https://flow.google.com/project/p/scene/s', clips: ['clip 1'] };
  }
  async extendAvailability() {
    return this.availability;
  }
  async prepare(action: SceneAction): Promise<PanelState> {
    this.log.push(`prepare ${action}`);
    return { summary: action, creditCost: null };
  }
  async submit() {
    this.log.push('scene submit');
  }
  async download(destination: string) {
    this.log.push(`scene download ${destination}`);
  }
  async close() {}
}

export class FakeCharacterStudio implements CharacterStudio {
  constructor(private readonly log: CallLog) {}
  async open() {
    return { presets: ['O comum'], model: 'Nano Banana 2' };
  }
  async prepare(): Promise<PanelState> {
    return { summary: 'Nano Banana 2', creditCost: 0 };
  }
  async submit() {
    this.log.push('character submit');
  }
  async leave() {}
}

export class FakeToolHost implements ToolHost {
  current: ToolControl[] = [
    { id: 0, kind: 'text', label: 'Theme' },
    { id: 1, kind: 'button', label: 'TUTORIAL' },
    { id: 2, kind: 'button', label: 'GENERATE' },
  ];
  constructor(private readonly log: CallLog) {}
  async list(_source: ToolSource): Promise<ToolSummary[]> {
    return [{ name: 'Grid Architect', author: 'someone', description: 'grids' }];
  }
  async open(name: string): Promise<OpenedTool> {
    return { name, createdCopy: false, controls: this.current };
  }
  async controls() {
    return this.current;
  }
  async fill(id: number, value: string) {
    this.log.push(`fill ${id} ${value}`);
  }
  async click(id: number) {
    this.log.push(`click ${id}`);
  }
  async close() {}
}

export class FakeVault implements FileVault {
  async verifyUpload(path: string): Promise<VerifiedFile> {
    return { absolutePath: path, kind: 'image', bytes: 10 };
  }
  async reserveOutput(fileName: string) {
    return `/out/${fileName}`;
  }
  async discard(_path: string) {}
}

export class FakeClock implements Clock {
  constructor(public t = 0) {}
  now() {
    return this.t;
  }
  async sleep(ms: number) {
    this.t += ms;
  }
}

export const allowAll: RateLimiter = { take: () => undefined };

export const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export function guardWith(limit: number, fallbackPerVariant = 20, clock: Clock = new FakeClock()): SpendGuard {
  return new SpendGuard(new SpendLedger(limit, fallbackPerVariant), allowAll, clock, silentLogger);
}
