import { beforeEach, describe, expect, it } from 'vitest';
import type { SpendGuard } from '../../src/application/spend-guard.js';
import { AssetUseCases } from '../../src/application/use-cases/assets.js';
import { CharacterUseCases } from '../../src/application/use-cases/characters.js';
import { GenerationUseCases } from '../../src/application/use-cases/generation.js';
import { SceneUseCases } from '../../src/application/use-cases/scenes.js';
import { ToolUseCases } from '../../src/application/use-cases/tools.js';
import {
  BudgetExceededError,
  InvalidInputError,
  NotFoundError,
  PreconditionFailedError,
  SpendNotConfirmedError,
  TimeoutError,
} from '../../src/domain/errors.js';
import {
  CallLog,
  FakeCharacterStudio,
  FakeClock,
  FakeComposer,
  FakeGrid,
  FakeLibrary,
  FakeSceneEditor,
  FakeToolHost,
  FakeVault,
  guardWith,
} from '../helpers/fakes.js';

const video = { prompt: 'a barista presents the new seasonal coffee', mode: 'video' as const, aspect: '9:16' as const };

describe('GenerationUseCases', () => {
  let log: CallLog;
  let composer: FakeComposer;
  let guard: SpendGuard;
  let generation: GenerationUseCases;

  beforeEach(() => {
    log = new CallLog();
    composer = new FakeComposer(log);
    guard = guardWith(50);
    generation = new GenerationUseCases(composer, new FakeLibrary(log, composer), guard);
  });

  it('prepares, reports Flow\'s price and spends nothing when confirm=false', async () => {
    const outcome = await generation.generate({ ...video, confirm: false });
    expect(outcome.status).toBe('prepared');
    expect(outcome.panel.creditCost).toBe(12);
    expect(log.calls).not.toContain('submit');
    expect(guard.remaining).toBe(50);
  });

  const quoted = async (input: typeof video & Record<string, unknown>) =>
    (await generation.generate({ ...input, confirm: false })).quote!.quoteId;

  it('charges the price Flow shows when confirmed with the quote', async () => {
    const quoteId = await quoted(video);
    const outcome = await generation.generate({ ...video, confirm: true, quoteId });
    expect(outcome.status).toBe('submitted');
    expect(outcome.creditsCharged).toBe(12);
    expect(guard.remaining).toBe(38);
  });

  it('refuses a blind confirm without touching the UI', async () => {
    await expect(generation.generate({ ...video, confirm: true })).rejects.toThrow(SpendNotConfirmedError);
    expect(log.calls).toEqual([]);
  });

  it('refuses a quote issued for a different request', async () => {
    const quoteId = await quoted(video);
    log.calls = [];
    await expect(generation.generate({ ...video, prompt: 'something else', confirm: true, quoteId })).rejects.toThrow(
      SpendNotConfirmedError,
    );
    expect(log.calls).toEqual([]);
  });

  it('refuses to reuse a quote', async () => {
    const quoteId = await quoted(video);
    await generation.generate({ ...video, confirm: true, quoteId });
    await expect(generation.generate({ ...video, confirm: true, quoteId })).rejects.toThrow(SpendNotConfirmedError);
    expect(log.count('submit')).toBe(1);
  });

  it('refuses when the price went up after the quote', async () => {
    const quoteId = await quoted(video);
    composer.price = 30;
    await expect(generation.generate({ ...video, confirm: true, quoteId })).rejects.toThrow(PreconditionFailedError);
    expect(log.calls).not.toContain('submit');
  });

  it('charges the conservative estimate per variant when the price is not shown', async () => {
    composer.price = null;
    const quoteId = await quoted({ ...video, variants: 2 });
    const outcome = await generation.generate({ ...video, variants: 2, confirm: true, quoteId });
    expect(outcome.creditsCharged).toBe(40);
  });

  it('configures before attaching, because a mode switch drops attachments', async () => {
    await generation.generate({ ...video, attachIndices: [3], attachResources: ['Ana'], confirm: false });
    expect(log.calls.slice(0, 4)).toEqual(['clear', 'configure video', 'attach 3', 'attach resource Ana']);
  });

  it('aborts before submit when references vanished, and charges nothing', async () => {
    const quoteId = await quoted(video);
    composer.scriptedReferences = [
      { videos: 1, images: 1 }, // after typing the prompt
      { videos: 0, images: 1 }, // right before the click
    ];
    await expect(generation.generate({ ...video, confirm: true, quoteId })).rejects.toThrow(PreconditionFailedError);
    expect(log.calls).not.toContain('submit');
    expect(guard.remaining).toBe(50);
  });

  it('refuses when the budget cannot cover the price', async () => {
    composer.price = 60;
    const quoteId = await quoted(video);
    await expect(generation.generate({ ...video, confirm: true, quoteId })).rejects.toThrow(BudgetExceededError);
    expect(log.calls).not.toContain('submit');
  });

  it('requires frames only in frames mode', async () => {
    await expect(generation.generate({ ...video, mode: 'frames', confirm: false })).rejects.toThrow(InvalidInputError);
    await expect(generation.generate({ ...video, startFrame: 'a.png', confirm: false })).rejects.toThrow(InvalidInputError);
    await generation.generate({ ...video, mode: 'frames', startFrame: 'a.png', endFrame: 'b.png', confirm: false });
    expect(log.calls).toContain('frame start a.png');
    expect(log.calls).toContain('frame end b.png');
  });

  it('runs a frames shot list only when every shot has its start frame', async () => {
    const frames = { ...video, mode: 'frames' as const };
    await expect(generation.runShotList({ ...frames, shots: [{ prompt: 'a' }], confirm: false })).rejects.toThrow(InvalidInputError);
    await generation.runShotList({ ...frames, shots: [{ prompt: 'a', startFrame: 'base' }], confirm: false });
    expect(log.calls).toContain('frame start base');
  });

  it('checks a whole shot list against the budget before the first submit', async () => {
    const shots = [{ prompt: 'a' }, { prompt: 'b' }, { prompt: 'c' }, { prompt: 'd' }, { prompt: 'e' }];
    const [preview] = await generation.runShotList({ ...video, shots, confirm: false });
    expect(preview!.quote!.credits).toBe(60);
    await expect(generation.runShotList({ ...video, shots, confirm: true, quoteId: preview!.quote!.quoteId })).rejects.toThrow(
      BudgetExceededError,
    );
    expect(log.calls).not.toContain('submit');
  });

  it('runs a shot list, reattaching the character on every shot', async () => {
    const shots = [{ prompt: 'shot 1', attachResources: ['Ana'] }, { prompt: 'shot 2', attachResources: ['Ana'] }];
    const [preview] = await generation.runShotList({ ...video, shots, confirm: false });
    const outcomes = await generation.runShotList({ ...video, shots, confirm: true, quoteId: preview!.quote!.quoteId });
    expect(outcomes.map((o) => o.status)).toEqual(['submitted', 'submitted']);
    expect(log.count('attach resource Ana')).toBe(3); // preview call + confirmed run (first shot reused, second prepared)
    expect(log.count('submit')).toBe(2);
    expect(guard.remaining).toBe(26);
  });
});

describe('manual submit mode', () => {
  it('hands the generate click to the user and says what to do next', async () => {
    const log = new CallLog();
    const composer = new FakeComposer(log);
    composer.submit = async () => {
      log.push('handed');
      return 'handed-to-user' as const;
    };
    const generation = new GenerationUseCases(composer, new FakeLibrary(log, composer), guardWith(50), 'manual');
    const quoteId = (await generation.generate({ ...video, confirm: false })).quote!.quoteId;
    const outcome = await generation.generate({ ...video, confirm: true, quoteId });
    expect(outcome.status).toBe('awaiting_user_click');
    expect(outcome.nextStep).toMatch(/click the generate arrow/);
    expect(log.calls).toContain('handed');
  });

  it('refuses confirmed shot lists, which need automatic clicks', async () => {
    const log = new CallLog();
    const composer = new FakeComposer(log);
    const generation = new GenerationUseCases(composer, new FakeLibrary(log, composer), guardWith(50), 'manual');
    await expect(generation.runShotList({ ...video, shots: [{ prompt: 'a' }], confirm: true, quoteId: 'deadbeef' })).rejects.toThrow(
      /one shot at a time/,
    );
    expect(log.calls).toEqual([]);
  });
});

describe('failure advice', () => {
  it('explains Flow abuse protection without promising a workaround', async () => {
    const grid = new FakeGrid(new CallLog());
    grid.assets = [{ index: 0, kind: 'failed', name: '', ready: false, error: 'Notamos uma atividade incomum. You have not been charged.' }];
    const assets = new AssetUseCases(grid, new FakeVault(), guardWith(10), new FakeClock());
    await expect(assets.waitUntilSettled(1, 60_000, 30_000)).rejects.toThrow(/abuse protection.*does not try to get around it.*FLOW_MCP_SUBMIT=manual/);
  });
});

describe('AssetUseCases', () => {
  let grid: FakeGrid;
  let guard: SpendGuard;
  let assets: AssetUseCases;

  beforeEach(() => {
    grid = new FakeGrid(new CallLog());
    grid.assets = [
      { index: 0, kind: 'video', name: 'take 1', ready: true },
      { index: 1, kind: 'image', name: 'ref', ready: false },
      { index: 2, kind: 'scene', name: 'Scene', ready: true },
    ];
    guard = guardWith(20);
    assets = new AssetUseCases(grid, new FakeVault(), guard, new FakeClock());
  });

  it('downloads the free export without confirmation', async () => {
    const result = await assets.download({ index: 0, quality: 'standard', fileName: 'shot01', confirm: false });
    expect(result).toEqual({ status: 'saved', savedTo: '/out/shot01.mp4', creditsCharged: 0 });
  });

  it('quotes a paid upscale first and downloads only with the quote', async () => {
    const first = await assets.download({ index: 0, quality: '1080p', fileName: 'x', confirm: false });
    expect(first.status).toBe('quoted');
    expect(grid.downloads).toHaveLength(0);
    await expect(assets.download({ index: 0, quality: '1080p', fileName: 'x', confirm: true })).rejects.toThrow(SpendNotConfirmedError);
    const quoteId = first.status === 'quoted' ? first.quote.quoteId : '';
    const done = await assets.download({ index: 0, quality: '1080p', fileName: 'x', confirm: true, quoteId });
    expect(done).toMatchObject({ status: 'saved', creditsCharged: 20 });
  });

  it.each(['../escape', '.hidden', 'a/b', 'x'.repeat(121)])('rejects file name %s', async (fileName) => {
    await expect(assets.download({ index: 0, quality: 'standard', fileName, confirm: false })).rejects.toThrow(InvalidInputError);
  });

  it('rejects missing, unfinished and scene tiles where they do not fit', async () => {
    await expect(assets.addToScene(9)).rejects.toThrow(NotFoundError);
    await expect(assets.addToScene(1)).rejects.toThrow(PreconditionFailedError);
    await expect(assets.download({ index: 2, quality: 'standard', fileName: 'x', confirm: false })).rejects.toThrow(InvalidInputError);
  });

  it('stops waiting as soon as Flow reports a failed generation', async () => {
    grid.assets = [
      { index: 0, kind: 'failed', name: '', ready: false, error: 'Falha ao gerar áudio.' },
      { index: 1, kind: 'video', name: 'take 1', ready: true },
    ];
    await expect(assets.waitUntilSettled(2, 600_000, 30_000)).rejects.toThrow(/Falha ao gerar áudio/);
  });

  it('ignores an old failure once the expected media is there', async () => {
    grid.assets = [
      { index: 0, kind: 'video', name: 'take 2', ready: true },
      { index: 1, kind: 'failed', name: '', ready: false, error: 'old failure' },
      { index: 2, kind: 'video', name: 'take 1', ready: true },
    ];
    expect(await assets.waitUntilSettled(2, 600_000, 30_000)).toHaveLength(3);
  });

  it('keeps waiting while something is still rendering, even with a failure on screen', async () => {
    grid.assets = [
      { index: 0, kind: 'video', name: '', ready: false },
      { index: 1, kind: 'failed', name: '', ready: false, error: 'old failure' },
    ];
    await expect(assets.waitUntilSettled(2, 60_000, 30_000)).rejects.toThrow(TimeoutError);
  });

  it('refuses to attach or download a failed tile', async () => {
    grid.assets = [{ index: 0, kind: 'failed', name: '', ready: false, error: 'Falha.' }];
    await expect(assets.addToScene(0)).rejects.toThrow(/failed generation/);
  });

  it('times out waiting for an unfinished grid', async () => {
    await expect(assets.waitUntilSettled(3, 60_000, 30_000)).rejects.toThrow(TimeoutError);
  });
});

describe('SceneUseCases', () => {
  let log: CallLog;
  let editor: FakeSceneEditor;
  let scenes: SceneUseCases;

  beforeEach(() => {
    log = new CallLog();
    editor = new FakeSceneEditor(log);
    scenes = new SceneUseCases(new FakeGrid(log), editor, new FakeVault(), guardWith(100));
  });

  it('refuses to extend when Flow disables it, before touching anything', async () => {
    editor.availability = { available: false, model: 'Veo 3.1 - Lite', reason: 'Only Veo videos can be extended' };
    await expect(scenes.act({ action: 'extend', prompt: 'keep walking', confirm: false })).rejects.toThrow(/Only Veo/);
    expect(log.calls).toEqual([]);
  });

  it('extends with the estimate when Flow shows no price', async () => {
    const prepared = await scenes.act({ action: 'extend', prompt: 'keep walking', confirm: false });
    const outcome = await scenes.act({ action: 'extend', prompt: 'keep walking', confirm: true, quoteId: prepared.quote!.quoteId });
    expect(outcome.creditsCharged).toBe(20);
    expect(log.calls).toEqual(['prepare extend', 'prepare extend', 'scene submit']);
  });

  it('exports the scene as mp4', async () => {
    expect(await scenes.download('final cut')).toEqual({ savedTo: '/out/final cut.mp4' });
  });
});

describe('CharacterUseCases', () => {
  it('prepares without submitting, then submits on confirm', async () => {
    const log = new CallLog();
    const characters = new CharacterUseCases(new FakeCharacterStudio(log), guardWith(10));
    const prepared = await characters.create({ prompt: 'a calm barista, 40s', confirm: false });
    expect(prepared.status).toBe('prepared');
    expect(log.calls).toEqual([]);
    // Even at 0 credits a confirmation needs the quote: no blind submits.
    await expect(characters.create({ prompt: 'a calm barista, 40s', confirm: true })).rejects.toThrow(SpendNotConfirmedError);
    const confirmed = await characters.create({ prompt: 'a calm barista, 40s', confirm: true, quoteId: prepared.quote!.quoteId });
    expect(confirmed.status).toBe('submitted');
    expect(log.calls).toEqual(['character submit']);
  });
});

describe('ToolUseCases', () => {
  let log: CallLog;
  let tools: ToolUseCases;

  beforeEach(() => {
    log = new CallLog();
    tools = new ToolUseCases(new FakeToolHost(log), guardWith(100));
  });

  it('clicks harmless buttons freely', async () => {
    expect(await tools.click({ controlId: 1, confirm: false })).toMatchObject({ status: 'clicked', creditsCharged: 0 });
    expect(log.calls).toEqual(['click 1']);
  });

  it('quotes generate-like buttons before clicking them', async () => {
    const first = await tools.click({ controlId: 2, confirm: false });
    expect(first.status).toBe('quoted');
    expect(log.calls).toEqual([]);
    await expect(tools.click({ controlId: 2, confirm: true })).rejects.toThrow(SpendNotConfirmedError);
    const quoteId = first.status === 'quoted' ? first.quote.quoteId : '';
    expect(await tools.click({ controlId: 2, confirm: true, quoteId })).toMatchObject({ status: 'clicked', creditsCharged: 20 });
  });

  it('rejects stale control ids', async () => {
    await expect(tools.click({ controlId: 9, confirm: true })).rejects.toThrow(NotFoundError);
  });
});
