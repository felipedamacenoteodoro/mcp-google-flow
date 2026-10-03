import { mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { InvalidInputError, NotFoundError, RateLimitedError } from '../../src/domain/errors.js';
import { loopbackEndpoint } from '../../src/infrastructure/browser/cdp-endpoint.js';
import { loadLabels } from '../../src/infrastructure/flow/ui-labels.js';
import { SandboxedFileVault } from '../../src/infrastructure/fs/sandboxed-file-vault.js';
import { redact } from '../../src/infrastructure/system/logger.js';
import { SlidingWindowLimiter } from '../../src/infrastructure/system/sliding-window-limiter.js';
import { FakeClock } from '../helpers/fakes.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const MP4 = Buffer.concat([Buffer.from('00000018', 'hex'), Buffer.from('ftypmp42'), Buffer.alloc(8)]);

describe('SandboxedFileVault', () => {
  let root: string;
  let input: string;
  let output: string;
  let vault: SandboxedFileVault;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'vault-')));
    input = join(root, 'in');
    output = join(root, 'out');
    vault = await SandboxedFileVault.create([input], output, { maxImageBytes: 1024, maxVideoBytes: 1024 });
  });

  it('accepts files whose content matches the extension', async () => {
    await writeFile(join(input, 'ref.png'), PNG);
    await writeFile(join(input, 'motion.mp4'), MP4);
    expect((await vault.verifyUpload(join(input, 'ref.png'))).kind).toBe('image');
    expect((await vault.verifyUpload(join(input, 'motion.mp4'))).kind).toBe('video');
  });

  it('rejects files outside the input roots', async () => {
    await writeFile(join(root, 'secret.png'), PNG);
    await expect(vault.verifyUpload(join(root, 'secret.png'))).rejects.toThrow(InvalidInputError);
    await expect(vault.verifyUpload(join(input, '..', 'secret.png'))).rejects.toThrow(InvalidInputError);
  });

  it('rejects a symlink inside the root that points outside it', async () => {
    await writeFile(join(root, 'secret.png'), PNG);
    await symlink(join(root, 'secret.png'), join(input, 'innocent.png'));
    await expect(vault.verifyUpload(join(input, 'innocent.png'))).rejects.toThrow(InvalidInputError);
  });

  it('rejects disguised, relative, missing and oversized files', async () => {
    await writeFile(join(input, 'fake.png'), 'not really a png');
    await writeFile(join(input, 'big.png'), Buffer.concat([PNG, Buffer.alloc(2048)]));
    await expect(vault.verifyUpload(join(input, 'fake.png'))).rejects.toThrow(InvalidInputError);
    await expect(vault.verifyUpload('in/ref.png')).rejects.toThrow(InvalidInputError);
    await expect(vault.verifyUpload(join(input, 'nope.png'))).rejects.toThrow(NotFoundError);
    await expect(vault.verifyUpload(join(input, 'big.png'))).rejects.toThrow(InvalidInputError);
  });

  it('reserves unique output files and never follows planted symlinks', async () => {
    const first = await vault.reserveOutput('shot.mp4');
    const second = await vault.reserveOutput('shot.mp4');
    expect(first).toBe(join(output, 'shot.mp4'));
    expect(second).toBe(join(output, 'shot-1.mp4'));

    await writeFile(join(root, 'target.txt'), 'original');
    await symlink(join(root, 'target.txt'), join(output, 'trap.mp4'));
    const reserved = await vault.reserveOutput('trap.mp4');
    expect(reserved).toBe(join(output, 'trap-1.mp4'));
    expect(await readFile(join(root, 'target.txt'), 'utf8')).toBe('original');
  });

  it('discards only empty reserved files inside the output folder', async () => {
    const empty = await vault.reserveOutput('failed.mp4');
    await vault.discard(empty);
    await expect(readFile(empty)).rejects.toThrow();
    const kept = await vault.reserveOutput('good.mp4');
    await writeFile(kept, 'data');
    await vault.discard(kept);
    expect(await readFile(kept, 'utf8')).toBe('data');
    await writeFile(join(root, 'outside.txt'), '');
    await vault.discard(join(root, 'outside.txt'));
    expect(await readFile(join(root, 'outside.txt'), 'utf8')).toBe('');
  });
});

describe('loopbackEndpoint', () => {
  it('accepts loopback endpoints', () => {
    expect(loopbackEndpoint('http://127.0.0.1:9222/')).toBe('http://127.0.0.1:9222');
    expect(loopbackEndpoint('http://localhost:9222')).toBe('http://localhost:9222');
  });

  it.each(['http://192.168.0.10:9222', 'http://0.0.0.0:9222', 'https://example.com', 'http://u:p@127.0.0.1:9222', 'file:///etc'])(
    'rejects %s',
    (url) => expect(() => loopbackEndpoint(url)).toThrow(InvalidInputError),
  );
});

describe('SlidingWindowLimiter', () => {
  it('blocks bursts and frees the slot after the window', () => {
    const clock = new FakeClock(0);
    const limiter = new SlidingWindowLimiter(2, 1000, clock);
    limiter.take();
    limiter.take();
    expect(() => limiter.take()).toThrow(RateLimitedError);
    clock.t = 1000;
    expect(() => limiter.take()).not.toThrow();
  });
});

describe('redact', () => {
  it('hides tokens, emails and cookies', () => {
    const line = redact('Bearer ya29.a0AfB_xyz key=AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE0 user=someone@gmail.com SAPISID=abc123;');
    expect(line).not.toMatch(/a0AfB|FAKEFAKE|someone|abc123/);
  });
});

describe('loadLabels', () => {
  it('merges a partial override', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'labels-'));
    const file = join(dir, 'labels.json');
    await writeFile(file, JSON.stringify({ submit: 'Generate', pickerTabs: { voices: 'Voices' } }));
    const labels = await loadLabels(file);
    expect(labels.submit).toBe('Generate');
    expect(labels.pickerTabs.voices).toBe('Voices');
    expect(labels.pickerTabs.images).toBe('Imagens');
  });

  it('rejects unknown keys so typos fail loudly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'labels-'));
    const file = join(dir, 'labels.json');
    await writeFile(file, JSON.stringify({ submitt: 'Generate' }));
    await expect(loadLabels(file)).rejects.toThrow();
  });
});
