import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripIcon } from '../../src/infrastructure/flow/flow-page.js';
import { DEFAULT_LABELS } from '../../src/infrastructure/flow/ui-labels.js';

describe('stripIcon', () => {
  it.each([
    ['videocam Vídeo', 'Vídeo'],
    ['crop_9_16 9:16', '9:16'],
    ['crop_landscape 4:3', '4:3'],
    ['360p info', '360p'],
    ['720p', '720p'],
    ['x1', 'x1'],
    ['volume_up Omni 1.1 Flash', 'Omni 1.1 Flash'],
  ])('%s -> %s', (raw, expected) => {
    expect(stripIcon(raw)).toBe(expected);
  });
});

describe('credit cost label', () => {
  const pattern = new RegExp(DEFAULT_LABELS.creditCost, 'i');
  it.each([
    ['A geração vai usar 12 créditos', 12],
    ['0 créditos', 0],
    ['This will use 1 credit', 1],
  ])('reads "%s"', (text, expected) => {
    expect(Number(pattern.exec(text)?.[1])).toBe(expected);
  });
});

// "Trojan Source" guard: invisible bidi or zero-width characters can make code
// read differently from how it runs. None may appear anywhere in the repo.
describe('source hygiene', () => {
  const hidden = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  const sources = ['src', 'tests'].flatMap(files).concat(['README.md', 'SECURITY.md', 'package.json']);

  it.each(sources)('%s has no hidden characters', (file) => {
    expect(hidden.test(readFileSync(file, 'utf8'))).toBe(false);
  });
});
