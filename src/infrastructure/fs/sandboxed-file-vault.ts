import { open, mkdir, realpath, rm, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { FileVault, VerifiedFile } from '../../application/ports.js';
import { InvalidInputError, NotFoundError } from '../../domain/errors.js';

interface Signature {
  kind: 'image' | 'video';
  extensions: string[];
  matches: (head: Buffer) => boolean;
}

// Content is checked by magic bytes; the extension alone proves nothing.
const SIGNATURES: Signature[] = [
  { kind: 'image', extensions: ['.png'], matches: (h) => h.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  { kind: 'image', extensions: ['.jpg', '.jpeg'], matches: (h) => h.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) },
  { kind: 'image', extensions: ['.webp'], matches: (h) => h.toString('latin1', 0, 4) === 'RIFF' && h.toString('latin1', 8, 12) === 'WEBP' },
  { kind: 'video', extensions: ['.mp4', '.mov', '.m4v'], matches: (h) => h.toString('latin1', 4, 8) === 'ftyp' },
  { kind: 'video', extensions: ['.webm'], matches: (h) => h.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')) },
];

export interface VaultLimits {
  maxImageBytes: number;
  maxVideoBytes: number;
}

/**
 * The only way file paths from the agent reach the browser or the disk.
 * Uploads must live under an allowed input root (after resolving symlinks);
 * outputs are created exclusively inside the output directory.
 */
export class SandboxedFileVault implements FileVault {
  private constructor(
    private readonly inputRoots: string[],
    private readonly outputDir: string,
    private readonly limits: VaultLimits,
  ) {}

  static async create(inputRoots: string[], outputDir: string, limits: VaultLimits): Promise<SandboxedFileVault> {
    const roots = await Promise.all(
      inputRoots.map(async (root) => {
        await mkdir(root, { recursive: true, mode: 0o700 });
        return realpath(root);
      }),
    );
    await mkdir(outputDir, { recursive: true, mode: 0o700 });
    return new SandboxedFileVault(roots, await realpath(outputDir), limits);
  }

  async verifyUpload(path: string): Promise<VerifiedFile> {
    if (!isAbsolute(path)) throw new InvalidInputError('Upload path must be absolute.');

    let real: string;
    try {
      real = await realpath(path);
    } catch {
      throw new NotFoundError('Upload file not found.');
    }
    if (!this.inputRoots.some((root) => isInside(root, real))) {
      throw new InvalidInputError(`Uploads are only allowed from: ${this.inputRoots.join(', ')}`);
    }

    const info = await stat(real);
    if (!info.isFile()) throw new InvalidInputError('Upload path is not a regular file.');

    const signature = await this.detect(real);
    const max = signature.kind === 'image' ? this.limits.maxImageBytes : this.limits.maxVideoBytes;
    if (info.size > max) {
      throw new InvalidInputError(`File is ${info.size} bytes; the ${signature.kind} limit is ${max}.`);
    }
    return { absolutePath: real, kind: signature.kind, bytes: info.size };
  }

  async reserveOutput(fileName: string): Promise<string> {
    const safe = basename(fileName);
    const ext = extname(safe);
    const stem = safe.slice(0, safe.length - ext.length);
    for (let n = 0; n < 1000; n++) {
      const candidate = join(this.outputDir, n === 0 ? safe : `${stem}-${n}${ext}`);
      try {
        // 'wx' fails if anything (including a planted symlink) already exists.
        const handle = await open(candidate, 'wx', 0o600);
        await handle.close();
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    throw new InvalidInputError('Could not find a free output file name.');
  }

  async discard(path: string): Promise<void> {
    // Only files inside the output directory, and only empty ones, are ever removed.
    if (!isInside(this.outputDir, path)) return;
    const info = await stat(path).catch(() => null);
    if (info?.isFile() && info.size === 0) await rm(path, { force: true });
  }

  private async detect(path: string): Promise<Signature> {
    const handle = await open(path, 'r');
    try {
      const head = Buffer.alloc(16);
      await handle.read(head, 0, 16, 0);
      const ext = extname(path).toLowerCase();
      const signature = SIGNATURES.find((s) => s.extensions.includes(ext) && s.matches(head));
      if (!signature) {
        throw new InvalidInputError('Only PNG, JPEG, WEBP, MP4, MOV and WEBM files whose content matches the extension are accepted.');
      }
      return signature;
    } finally {
      await handle.close();
    }
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, resolve(candidate));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}
