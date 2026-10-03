import { InvalidInputError } from './errors.js';

export const MAX_PROMPT_LENGTH = 4000;

// C0 controls (except \t and \n), DEL, zero-width and bidi-override characters.
// Bidi overrides can hide text from a human reviewing the prompt.
const UNSAFE_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** A prompt that is safe to type into the Flow composer, one entry per line. */
export class Prompt {
  private constructor(readonly lines: readonly string[]) {}

  static create(raw: string): Prompt {
    const cleaned = raw
      .normalize('NFC')
      .replace(/\r\n?/g, '\n')
      .replace(UNSAFE_CHARS, '')
      .replace(/\t/g, ' ');

    if (cleaned.trim().length === 0) {
      throw new InvalidInputError('Prompt is empty.');
    }
    if (cleaned.length > MAX_PROMPT_LENGTH) {
      throw new InvalidInputError(`Prompt exceeds ${MAX_PROMPT_LENGTH} characters.`);
    }
    return new Prompt(cleaned.split('\n'));
  }

  get text(): string {
    return this.lines.join('\n');
  }
}
