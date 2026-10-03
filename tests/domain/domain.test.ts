import { describe, expect, it } from 'vitest';
import { isGridSettled, qualitySpendsCredits } from '../../src/domain/asset.js';
import { BudgetExceededError, InvalidInputError, SpendNotConfirmedError } from '../../src/domain/errors.js';
import { createGenerationSettings } from '../../src/domain/generation.js';
import { FlowUrl } from '../../src/domain/project-url.js';
import { MAX_PROMPT_LENGTH, Prompt } from '../../src/domain/prompt.js';
import { SpendLedger } from '../../src/domain/spend-ledger.js';
import { toolActionMaySpend } from '../../src/domain/tools.js';

describe('Prompt', () => {
  it('keeps line structure and normalizes CRLF', () => {
    expect(Prompt.create('shot 1\r\nclose-up').lines).toEqual(['shot 1', 'close-up']);
  });

  it('strips control and bidi-override characters', () => {
    expect(Prompt.create('a\u0007b\u202Ec\u200Bd').text).toBe('abcd');
  });

  it('rejects empty and oversized prompts', () => {
    expect(() => Prompt.create(' \n\t ')).toThrow(InvalidInputError);
    expect(() => Prompt.create('x'.repeat(MAX_PROMPT_LENGTH + 1))).toThrow(InvalidInputError);
  });
});

describe('GenerationSettings', () => {
  it('defaults to one variant', () => {
    expect(createGenerationSettings({ mode: 'image', aspect: '1:1' }).variants).toBe(1);
  });

  it('rejects square video and out-of-range variants', () => {
    expect(() => createGenerationSettings({ mode: 'video', aspect: '1:1' })).toThrow(InvalidInputError);
    expect(() => createGenerationSettings({ mode: 'video', aspect: '9:16', variants: 5 })).toThrow(InvalidInputError);
  });

  it('restricts resolution and duration to video modes', () => {
    expect(() => createGenerationSettings({ mode: 'image', aspect: '1:1', resolution: '720p' })).toThrow(InvalidInputError);
    expect(() => createGenerationSettings({ mode: 'video', aspect: '9:16', durationSeconds: 5 })).toThrow(InvalidInputError);
    expect(createGenerationSettings({ mode: 'frames', aspect: '16:9', durationSeconds: 8 }).durationSeconds).toBe(8);
  });

  it('accepts menu-like model labels only', () => {
    expect(createGenerationSettings({ mode: 'video', aspect: '9:16', model: 'Omni 1.1 Flash' }).model).toBe('Omni 1.1 Flash');
    expect(() => createGenerationSettings({ mode: 'video', aspect: '9:16', model: '"]; alert(1)' })).toThrow(InvalidInputError);
  });
});

describe('FlowUrl', () => {
  it('accepts Flow project URLs and drops the fragment', () => {
    expect(FlowUrl.parse('https://flow.google.com/project/abc#x').href).toBe('https://flow.google.com/project/abc');
  });

  it.each([
    'http://flow.google.com/',
    'https://flow.google.com.evil.io/',
    'https://evil.io/?next=https://flow.google.com',
    'https://user:pass@flow.google.com/',
    'https://flow.google.com:8443/',
    'javascript:alert(1)',
  ])('rejects %s', (url) => {
    expect(() => FlowUrl.parse(url)).toThrow(InvalidInputError);
  });
});

describe('SpendLedger', () => {
  it('requires explicit confirmation', () => {
    expect(() => new SpendLedger(50, 20).authorize(12, false)).toThrow(SpendNotConfirmedError);
  });

  it('enforces the session credit budget', () => {
    const ledger = new SpendLedger(30, 20);
    ledger.authorize(20, true);
    ledger.record(20);
    expect(() => ledger.authorize(12, true)).toThrow(BudgetExceededError);
    expect(ledger.remaining).toBe(10);
  });

  it('never treats an unknown price as free', () => {
    const ledger = new SpendLedger(100, 20);
    expect(ledger.costOf(12, 3)).toBe(12);
    expect(ledger.costOf(null, 3)).toBe(60);
  });
});

describe('tools', () => {
  it.each(['GENERATE', 'Gerar vídeo', 'START ARCHITECTING', 'Render', 'Criar'])('treats "%s" as paid', (label) => {
    expect(toolActionMaySpend(label)).toBe(true);
  });

  it.each(['TUTORIAL', 'NEW GRID', 'ENGINE Nano Banana 2', 'Voltar'])('treats "%s" as free', (label) => {
    expect(toolActionMaySpend(label)).toBe(false);
  });
});

describe('assets', () => {
  it('settles only when every expected tile is ready', () => {
    const tile = { index: 0, kind: 'video' as const, name: 'take' };
    expect(isGridSettled([{ ...tile, ready: false }], 1)).toBe(false);
    expect(isGridSettled([{ ...tile, ready: true }], 2)).toBe(false);
    expect(isGridSettled([{ ...tile, ready: true }], 1)).toBe(true);
  });

  it('only the standard export is free', () => {
    expect(qualitySpendsCredits('standard')).toBe(false);
    expect(qualitySpendsCredits('1080p')).toBe(true);
    expect(qualitySpendsCredits('4k')).toBe(true);
  });
});
