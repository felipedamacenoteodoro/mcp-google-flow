import type { Asset, DownloadQuality } from '../domain/asset.js';
import type { GenerationOptions, GenerationSettings, PanelState, ReferenceCount } from '../domain/generation.js';
import type { ProjectSummary, Resource, ResourceCategory } from '../domain/library.js';
import type { FlowUrl } from '../domain/project-url.js';
import type { Prompt } from '../domain/prompt.js';
import type { ExtendAvailability, SceneAction, SceneSummary } from '../domain/scene.js';
import type { OpenedTool, ToolControl, ToolSource, ToolSummary } from '../domain/tools.js';

export interface WorkspaceStatus {
  readonly browserConnected: boolean;
  readonly signedIn: boolean;
  readonly currentUrl: string | null;
}

/** A local file that passed the vault's checks and may be handed to the browser. */
export interface VerifiedFile {
  readonly absolutePath: string;
  readonly kind: 'image' | 'video';
  readonly bytes: number;
}

/*
 * Flow is split into small ports, one per area of the app, so each use case
 * depends only on what it drives (interface segregation). The Playwright
 * adapters implement them; tests use in-memory fakes.
 */

export interface ProjectNavigator {
  status(): Promise<WorkspaceStatus>;
  openSignIn(): Promise<void>;
  /** Newest first, up to `limit`. */
  listProjects(limit: number): Promise<ProjectSummary[]>;
  createProject(): Promise<string>;
  openProject(url: FlowUrl): Promise<void>;
  screenshot(): Promise<Buffer>;
}

export interface MediaGrid {
  listAssets(): Promise<Asset[]>;
  /** Shows only scenes in the grid (true) or every asset again (false). */
  showScenes(onlyScenes: boolean): Promise<void>;
  upload(file: VerifiedFile): Promise<void>;
  addToScene(index: number): Promise<void>;
  download(index: number, quality: DownloadQuality, destination: string): Promise<void>;
}

export interface Composer {
  readOptions(): Promise<GenerationOptions>;
  configure(settings: GenerationSettings): Promise<PanelState>;
  /** Summary and price as the panel shows them now, without changing anything. */
  panelState(): Promise<PanelState>;
  attachAsset(index: number): Promise<void>;
  /** Frames mode only: fills the start or end slot with a resource from the picker. */
  setFrame(slot: 'start' | 'end', resourceName: string): Promise<void>;
  clear(): Promise<void>;
  references(): Promise<ReferenceCount>;
  writePrompt(prompt: Prompt): Promise<void>;
  submit(): Promise<void>;
}

export interface ResourceLibrary {
  search(query: string, category: ResourceCategory): Promise<Resource[]>;
  /** Attaches the first resource whose name matches exactly (then by prefix). */
  attach(name: string, category: ResourceCategory): Promise<Resource>;
}

export interface CharacterStudio {
  open(): Promise<{ presets: string[]; model: string }>;
  prepare(input: { preset?: string; prompt: Prompt; model?: string }): Promise<PanelState>;
  submit(): Promise<void>;
  leave(): Promise<void>;
}

export interface SceneEditor {
  /** Opens the scene shown at `index` while the grid is filtered to scenes. */
  open(index: number): Promise<SceneSummary>;
  extendAvailability(): Promise<ExtendAvailability>;
  prepare(action: SceneAction, prompt: Prompt): Promise<PanelState>;
  submit(): Promise<void>;
  /** Exports the whole timeline as one video. */
  download(destination: string): Promise<void>;
  close(): Promise<void>;
}

export interface ToolHost {
  list(source: ToolSource): Promise<ToolSummary[]>;
  open(name: string): Promise<OpenedTool>;
  controls(): Promise<ToolControl[]>;
  fill(controlId: number, value: string): Promise<void>;
  click(controlId: number): Promise<void>;
  close(): Promise<void>;
}

export interface FileVault {
  verifyUpload(path: string): Promise<VerifiedFile>;
  /** Returns an absolute path inside the output directory that does not exist yet. */
  reserveOutput(fileName: string): Promise<string>;
  /** Removes a reserved output that was never filled (e.g. the download failed). */
  discard(path: string): Promise<void>;
}

export interface RateLimiter {
  /** Throws RateLimitedError when the window is full. */
  take(): void;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}
