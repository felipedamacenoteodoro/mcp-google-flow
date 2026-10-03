#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SpendGuard } from './application/spend-guard.js';
import { AssetUseCases } from './application/use-cases/assets.js';
import { CharacterUseCases } from './application/use-cases/characters.js';
import { GenerationUseCases } from './application/use-cases/generation.js';
import { LibraryUseCases } from './application/use-cases/library.js';
import { ImagePlanningUseCases } from './application/use-cases/image-planning.js';
import { SceneUseCases } from './application/use-cases/scenes.js';
import { SessionUseCases } from './application/use-cases/session.js';
import { ToolUseCases } from './application/use-cases/tools.js';
import { SpendLedger } from './domain/spend-ledger.js';
import { BrowserSession } from './infrastructure/browser/browser-session.js';
import { ChromeLauncher, findChrome } from './infrastructure/browser/chrome-launcher.js';
import { loadConfig } from './infrastructure/config.js';
import { FlowCharacterStudio } from './infrastructure/flow/flow-character-studio.js';
import { FlowComposer } from './infrastructure/flow/flow-composer.js';
import { FlowMediaGrid } from './infrastructure/flow/flow-media-grid.js';
import { FlowNavigator } from './infrastructure/flow/flow-navigator.js';
import { FlowPage } from './infrastructure/flow/flow-page.js';
import { FlowResourceLibrary } from './infrastructure/flow/flow-resource-library.js';
import { FlowSceneEditor } from './infrastructure/flow/flow-scene-editor.js';
import { FlowToolHost } from './infrastructure/flow/flow-tool-host.js';
import { loadLabels } from './infrastructure/flow/ui-labels.js';
import { SandboxedFileVault } from './infrastructure/fs/sandboxed-file-vault.js';
import { systemClock } from './infrastructure/system/clock.js';
import { createStderrLogger } from './infrastructure/system/logger.js';
import { Mutex } from './infrastructure/system/mutex.js';
import { SlidingWindowLimiter } from './infrastructure/system/sliding-window-limiter.js';
import { registerGenerationTools } from './interface/mcp/tools/generation-tools.js';
import { registerGridTools } from './interface/mcp/tools/grid-tools.js';
import { registerPrompts } from './interface/mcp/prompts/index.js';
import { registerLibraryTools } from './interface/mcp/tools/library-tools.js';
import { registerImagePlanningTools } from './interface/mcp/tools/image-planning-tools.js';
import { registerSceneTools } from './interface/mcp/tools/scene-tools.js';
import { registerSessionTools } from './interface/mcp/tools/session-tools.js';
import { registerToolHostTools } from './interface/mcp/tools/tool-host-tools.js';

const HOUR_MS = 3_600_000;

/** Composition root: the only place that knows every concrete class. */
async function main(): Promise<void> {
  const logger = createStderrLogger();
  const config = loadConfig();

  const vault = await SandboxedFileVault.create(config.inputDirs, config.outputDir, {
    maxImageBytes: config.maxImageBytes,
    maxVideoBytes: config.maxVideoBytes,
  });
  const launcher = new ChromeLauncher(findChrome(config.chromePath), config.profileDir, systemClock);
  const browser = new BrowserSession(launcher, logger, config.cdpUrl);
  const flow = new FlowPage(browser, await loadLabels(config.uiLabelsPath), logger);

  const library = new FlowResourceLibrary(flow);
  const grid = new FlowMediaGrid(flow);
  const guard = new SpendGuard(
    new SpendLedger(config.maxCredits, config.fallbackCredits),
    new SlidingWindowLimiter(config.paidPerHour, HOUR_MS, systemClock),
    systemClock,
    logger,
  );

  const server = new McpServer({ name: 'flow-studio-mcp', version: '0.3.0' });
  const runtime = { server, mutex: new Mutex(), logger };
  registerSessionTools(runtime, new SessionUseCases(new FlowNavigator(flow)), guard);
  registerGridTools(runtime, new AssetUseCases(grid, vault, guard, systemClock));
  registerGenerationTools(runtime, new GenerationUseCases(new FlowComposer(flow, library), library, guard));
  registerLibraryTools(runtime, new LibraryUseCases(library), new CharacterUseCases(new FlowCharacterStudio(flow), guard));
  registerSceneTools(runtime, new SceneUseCases(grid, new FlowSceneEditor(flow), vault, guard));
  registerToolHostTools(runtime, new ToolUseCases(new FlowToolHost(flow), guard));
  registerImagePlanningTools(runtime, new ImagePlanningUseCases());
  registerPrompts(server);

  const shutdown = () => void browser.dispose().finally(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.stdin.once('end', shutdown);

  await server.connect(new StdioServerTransport());
  logger.info('flow-studio-mcp ready', { creditBudget: config.maxCredits, paidPerHour: config.paidPerHour });
}

main().catch((error: unknown) => {
  process.stderr.write(`flow-studio-mcp failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
