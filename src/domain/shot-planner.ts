import { accentLine, CAMERA_MOVES, MAX_COMFORTABLE_TALKING_SHOTS, SILENT, SINGLE_TAKE, voiceLine } from './craft.js';
import type { CameraMoveId, ShotRole, VoiceProfile } from './craft.js';
import { InvalidInputError } from './errors.js';
import { MAX_PROMPT_LENGTH } from './prompt.js';

/** Comfortable speaking pace: about 2.3 words per second leaves room to breathe. */
const WORDS_PER_SECOND = 2.3;
const MAX_SHOTS = 20;

/**
 * How people appear on screen:
 *  - solo:          one person talking to the lens
 *  - two-in-frame:  two people share every shot; one talks, the other listens
 *  - alternating:   two people, each shot shows only whoever is speaking
 *  - narration:     nobody talks on camera; shots illustrate a narration
 */
export const LAYOUTS = ['solo', 'two-in-frame', 'alternating', 'narration'] as const;
export type Layout = (typeof LAYOUTS)[number];

/** Everything that shapes the shots: who is on screen, framings, camera per role, extra rules. */
export interface ShotStyle {
  readonly layout: Layout;
  readonly aspect: '9:16' | '16:9';
  /** Framings cycled through the shots, in order. */
  readonly framings: readonly string[];
  /** Camera move per shot role; roles not listed use `body`. */
  readonly camera: Readonly<Partial<Record<ShotRole, CameraMoveId>>> & { readonly body: CameraMoveId };
  readonly rules: readonly string[];
}

export function speakersOf(layout: Layout): 0 | 1 | 2 {
  return layout === 'narration' ? 0 : layout === 'solo' ? 1 : 2;
}

/** Sensible defaults per layout; callers override framings, camera and rules as needed. */
export const DEFAULT_STYLES: Readonly<Record<Layout, ShotStyle>> = {
  solo: {
    layout: 'solo',
    aspect: '9:16',
    framings: ['medium close-up', 'close-up'],
    camera: { hook: 'snapZoom', body: 'natural', 'key-line': 'locked', 'call-to-action': 'slowZoom' },
    rules: ['The speaker looks into the lens the whole time.'],
  },
  'two-in-frame': {
    layout: 'two-in-frame',
    aspect: '9:16',
    framings: ['medium two-shot, both faces visible'],
    // Any camera move invites a cut to a single close-up, which breaks the two-person read.
    camera: { body: 'locked' },
    rules: [
      'Animate every clip from one image that contains both people.',
      'Only the speaker gets a voice description, otherwise both will talk.',
      'Both people stay in frame for the whole clip; never cut to one person alone.',
    ],
  },
  alternating: {
    layout: 'alternating',
    aspect: '9:16',
    framings: ['single medium close-up of the speaker', 'single medium shot of the speaker'],
    camera: { body: 'subtlePush', 'key-line': 'locked', reaction: 'locked' },
    rules: [
      'Each shot shows only the person speaking, looking slightly off to the side toward the other person.',
      'Both people keep the same place, clothes and props in every shot.',
    ],
  },
  narration: {
    layout: 'narration',
    aspect: '9:16',
    framings: ['establishing wide shot', 'detail close-up', 'medium shot with movement'],
    camera: { hook: 'snapZoom', body: 'drift', 'b-roll': 'orbit', 'call-to-action': 'pullBack' },
    rules: ['Every clip is silent; the narration is laid over the edit.', 'One narration sentence, one visual.'],
  },
};

/** Rules every generated shot follows. */
export const UNIVERSAL_RULES: readonly string[] = [
  'Prompt order: camera, optional gesture, spoken line, voice, accent, then the single-take line.',
  'One spoken sentence per clip; long lines are split across clips.',
  'Spoken words go in double quotes after a speech verb; gestures never go inside the quotes.',
  'At most one gesture before the line and one after it.',
  'The same visual and voice description, word for word, in every clip of a character.',
  'The prompt is in English even when the spoken line is not.',
  'Silent clips say that no one speaks and mouths stay closed, and carry no voice or accent.',
  'No on-screen text, captions or logos: add text in the edit.',
];

export type FramePosition = 'left' | 'right';

export interface CastMember {
  /** Name used in the script ("Ana: ..."). */
  readonly name: string;
  /** Visual description repeated verbatim in every shot. */
  readonly description: string;
  /** Voice description repeated verbatim in every shot this person speaks. */
  readonly voice?: VoiceProfile | string;
  /** two-in-frame only: where this person sits in the shared frame. */
  readonly position?: FramePosition;
  /** Library resource to attach (character, image), when there is one. */
  readonly resource?: string;
}

export interface PlanInput {
  readonly style: ShotStyle;
  /**
   * One line per turn. Optional markers:
   *   "Ana: ..."            speaker
   *   "[adjusts glasses]"   gesture at the start or end of the line
   *   "* ..."               key line (the idea that must land)
   */
  readonly script: string;
  readonly cast: readonly CastMember[];
  readonly setting: string;
  readonly language: string;
  readonly accent?: string;
  /** Look and mood, e.g. "natural daylight, realistic". */
  readonly look?: string;
  readonly shotSeconds: 4 | 6 | 8 | 10;
  /**
   * Library image every clip is animated from (frames mode, as the first
   * frame). The most faithful way to keep faces identical; for two-in-frame it
   * is one image with both people.
   */
  readonly baseImage?: string;
}

export interface PlannedShot {
  readonly index: number;
  readonly role: ShotRole;
  readonly speaker: string | null;
  readonly line: string;
  readonly framing: string;
  readonly camera: string;
  readonly prompt: string;
  readonly attachResources: string[];
  /** Set when the shot is animated from the base image. */
  readonly startFrame?: string;
}

export interface ShotPlan {
  readonly layout: Layout;
  /** Generation mode for flow_run_shot_list: "frames" when a base image is used. */
  readonly mode: 'video' | 'frames';
  readonly aspect: string;
  readonly shotSeconds: number;
  readonly maxWordsPerShot: number;
  readonly shots: PlannedShot[];
  readonly rules: string[];
  readonly warnings: string[];
}

interface Piece {
  speaker: CastMember | null;
  line: string;
  keyLine: boolean;
  before?: string;
  after?: string;
}

/**
 * Turns a script into one shot per spoken sentence and drafts each prompt in
 * a fixed order: scene, camera, gesture, line, gesture, voice, accent, and a
 * single-take instruction. Speaker changes, gestures and key lines come from
 * markers in the script; the camera move follows each shot's role.
 */
export function planShots(input: PlanInput): ShotPlan {
  validateCast(input);
  const maxWords = Math.floor(input.shotSeconds * WORDS_PER_SECOND);
  const pieces = parseScript(input.script, input.cast, speakersOf(input.style.layout)).flatMap((turn) => splitPiece(turn, maxWords));

  if (pieces.length === 0) throw new InvalidInputError('The script is empty.');
  if (pieces.length > MAX_SHOTS) {
    throw new InvalidInputError(`The script needs ${pieces.length} shots; the limit is ${MAX_SHOTS}. Shorten it or split the video.`);
  }

  const shots = pieces.map((piece, index): PlannedShot => {
    const role = roleOf(piece, index, pieces.length, input.style.layout);
    const framing = input.style.framings[index % input.style.framings.length]!;
    const camera = CAMERA_MOVES[input.style.camera[role] ?? input.style.camera.body].instruction;
    return {
      index,
      role,
      speaker: piece.speaker?.name ?? null,
      line: piece.line,
      framing,
      camera,
      prompt: composePrompt(input, piece, framing, camera),
      // Frames mode animates the base image itself; it takes no extra elements.
      attachResources: input.baseImage ? [] : attachmentsFor(input, piece.speaker),
      ...(input.baseImage ? { startFrame: input.baseImage } : {}),
    };
  });

  return {
    layout: input.style.layout,
    mode: input.baseImage ? 'frames' : 'video',
    aspect: input.style.aspect,
    shotSeconds: input.shotSeconds,
    maxWordsPerShot: maxWords,
    shots,
    rules: [...UNIVERSAL_RULES, ...input.style.rules],
    warnings: warningsFor(input, shots),
  };
}

function validateCast(input: PlanInput): void {
  if (input.style.framings.length === 0) throw new InvalidInputError('A shot style needs at least one framing.');
  const needed = speakersOf(input.style.layout);
  if (needed > 0 && input.cast.length < needed) {
    throw new InvalidInputError(`Layout "${input.style.layout}" needs ${needed} cast member(s); got ${input.cast.length}.`);
  }
  const names = input.cast.map((c) => c.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) throw new InvalidInputError('Cast names must be unique.');
  for (const member of input.cast) {
    if (!member.name.trim() || !member.description.trim()) {
      throw new InvalidInputError('Every cast member needs a name and a visual description.');
    }
  }
  if (input.style.layout === 'two-in-frame') {
    const [a, b] = positionsOf(input.cast);
    if (a === b) throw new InvalidInputError('With two people in frame they need different positions (left and right).');
  }
}

function parseScript(script: string, cast: readonly CastMember[], speakers: number): Piece[] {
  const byName = new Map(cast.map((c) => [c.name.trim().toLowerCase(), c]));
  let current: CastMember | null = speakers > 0 ? (cast[0] ?? null) : null;
  const pieces: Piece[] = [];

  for (const raw of script.replace(/\r\n?/g, '\n').split('\n')) {
    let line = raw.trim();
    if (!line) continue;

    const tagged = /^([^:[\]*]{1,40}):\s*(.+)$/.exec(line);
    if (tagged && speakers > 0) {
      const member = byName.get(tagged[1]!.trim().toLowerCase());
      if (!member) {
        throw new InvalidInputError(`"${tagged[1]}" speaks in the script but is not in the cast (${cast.map((c) => c.name).join(', ')}).`);
      }
      current = member;
      line = tagged[2]!.trim();
    }

    // Markers may come in either order: "* [smiles] line" or "[smiles] * line".
    let keyLine = line.startsWith('*');
    if (keyLine) line = line.slice(1).trim();
    const before = /^\[([^\]]+)\]\s*/.exec(line);
    if (before) line = line.slice(before[0].length);
    if (line.startsWith('*')) {
      keyLine = true;
      line = line.slice(1).trim();
    }
    const after = /\s*\[([^\]]+)\]$/.exec(line);
    if (after) line = line.slice(0, line.length - after[0].length);
    if (/[[\]]/.test(line)) {
      throw new InvalidInputError(`Gestures go at the start or end of a line, one each: "${raw.trim()}".`);
    }
    if (!line.trim()) continue;

    pieces.push({
      speaker: current,
      line: line.trim(),
      keyLine,
      ...(before ? { before: before[1]!.trim() } : {}),
      ...(after ? { after: after[1]!.trim() } : {}),
    });
  }
  return pieces;
}

/** One sentence per shot; a sentence too long for one shot is split at word boundaries. */
export function splitToFit(text: string, maxWords: number): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]*["”']?/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  return sentences.flatMap((sentence) => {
    const words = sentence.split(/\s+/);
    if (words.length <= maxWords) return [sentence];
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += maxWords) chunks.push(words.slice(i, i + maxWords).join(' '));
    return chunks;
  });
}

/** Splits a turn into shots, keeping the opening gesture on the first and the closing one on the last. */
function splitPiece(piece: Piece, maxWords: number): Piece[] {
  const lines = splitToFit(piece.line, maxWords);
  return lines.map((line, i) => {
    const part: Piece = { speaker: piece.speaker, line, keyLine: piece.keyLine };
    if (i === 0 && piece.before) part.before = piece.before;
    if (i === lines.length - 1 && piece.after) part.after = piece.after;
    return part;
  });
}

function roleOf(piece: Piece, index: number, total: number, layout: Layout): ShotRole {
  if (piece.keyLine) return 'key-line';
  if (index === 0) return 'hook';
  if (index === total - 1) return 'call-to-action';
  return layout === 'narration' ? 'b-roll' : 'body';
}

function composePrompt(input: PlanInput, piece: Piece, framing: string, camera: string): string {
  const lines: string[] = [];
  const speaker = piece.speaker;
  const layout = input.style.layout;
  const silent = layout === 'narration' || !speaker;

  // 1. Scene: framing, who is in it, where.
  if (silent) {
    lines.push(`${capitalize(framing)} illustrating: ${piece.line}`);
  } else if (layout === 'two-in-frame') {
    const [left, right] = orderByPosition(input.cast);
    const speakerSide = positionOf(input.cast, speaker);
    const listenerSide = speakerSide === 'left' ? 'right' : 'left';
    lines.push(
      `${capitalize(framing)}. Two people in the same frame: on the left, ${left.description}; on the right, ${right.description}.`,
      `The person on the ${speakerSide} speaks. The person on the ${listenerSide} only listens, nodding and reacting with their mouth closed, and never interrupts.`,
      'Both people stay in the same frame for the entire clip; never cut to a shot of one person alone.',
    );
  } else if (layout === 'alternating') {
    lines.push(`${capitalize(framing)}. ${capitalize(speaker.description)}, alone in the frame, looking slightly off to the side toward the other guest.`);
  } else {
    lines.push(`${capitalize(framing)}. ${capitalize(speaker.description)}, looking into the lens.`);
  }
  lines.push(`Setting: ${input.setting}.`);

  // 2. Camera.
  lines.push(`Camera: ${camera}`);

  // 3-7. Gesture, line, gesture, voice, accent; or silence.
  if (silent) {
    lines.push(SILENT);
  } else {
    const who = layout === 'two-in-frame' ? `The person on the ${positionOf(input.cast, speaker)}` : 'They';
    lines.push(piece.before ? `${who} ${piece.before}, then says: "${piece.line}"` : `${who} says: "${piece.line}"`);
    if (piece.after) lines.push(`After the line, they ${piece.after}.`);
    if (speaker.voice) lines.push(`Voice: ${voiceLine(speaker.voice)}`);
    lines.push(accentLine(input.language, input.accent));
  }

  if (input.look) lines.push(`Style: ${input.look}.`);
  lines.push('No on-screen text, captions or logos.', SINGLE_TAKE);

  const prompt = lines.join('\n');
  if (prompt.length > MAX_PROMPT_LENGTH) throw new InvalidInputError('A drafted shot prompt is too long; shorten the descriptions.');
  return prompt;
}

/** Everyone visible is attached: both people when they share the frame, otherwise the speaker (or the whole cast for narration). */
function attachmentsFor(input: PlanInput, speaker: CastMember | null): string[] {
  const visible = input.style.layout === 'two-in-frame' || !speaker ? input.cast : [speaker];
  return visible.map((c) => c.resource).filter((r): r is string => Boolean(r));
}

function warningsFor(input: PlanInput, shots: PlannedShot[]): string[] {
  const warnings: string[] = [];
  if (input.style.layout === 'two-in-frame' && !input.baseImage) {
    warnings.push('No base_image: with two people in frame, one image with both of them keeps faces and positions steady across clips.');
  }
  const talking = shots.filter((s) => s.speaker !== null).length;
  if (talking > MAX_COMFORTABLE_TALKING_SHOTS) {
    warnings.push(
      `${talking} talking shots: lip-sync gets less reliable on long scripts. Consider trimming, or narration over silent footage.`,
    );
  }
  for (const member of input.cast) {
    if (speakersOf(input.style.layout) > 0 && !member.voice && shots.some((s) => s.speaker === member.name)) {
      warnings.push(`${member.name} has no voice description, so the voice may change between clips.`);
    }
  }
  return warnings;
}

/** Explicit positions win; a missing one takes the side opposite the other person (default: first on the left). */
function positionsOf(cast: readonly CastMember[]): [FramePosition, FramePosition] {
  const opposite = (p: FramePosition): FramePosition => (p === 'left' ? 'right' : 'left');
  const second = cast[1]?.position;
  const first = cast[0]?.position ?? (second ? opposite(second) : 'left');
  return [first, second ?? opposite(first)];
}

function positionOf(cast: readonly CastMember[], member: CastMember): FramePosition {
  return positionsOf(cast)[cast.indexOf(member) === 0 ? 0 : 1];
}

function orderByPosition(cast: readonly CastMember[]): [CastMember, CastMember] {
  const [a, b] = [cast[0]!, cast[1]!];
  return positionOf(cast, a) === 'left' ? [a, b] : [b, a];
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
