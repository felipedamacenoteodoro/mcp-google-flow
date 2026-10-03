import { InvalidInputError } from './errors.js';

/**
 * Directing craft for talking-avatar video, shared by the planner and the
 * guided flows: camera moves chosen by the job a shot does, small gestures
 * that make a presenter look alive, and consistent voice descriptions.
 */

/** What a shot does in the edit; the camera follows from it. */
export type ShotRole = 'hook' | 'body' | 'key-line' | 'call-to-action' | 'reaction' | 'b-roll';

export interface CameraMove {
  readonly id: string;
  readonly instruction: string;
  readonly useFor: string;
}

export const CAMERA_MOVES = {
  natural: { id: 'natural', instruction: 'Static camera with slight natural handheld movement.', useFor: 'the body of an argument' },
  locked: { id: 'locked', instruction: 'Tripod-locked camera, completely still.', useFor: 'the key line, so nothing competes with it' },
  slowZoom: { id: 'slowZoom', instruction: 'Slow continuous zoom toward the face, then holds on the close-up.', useFor: 'closing lines and calls to action' },
  snapZoom: { id: 'snapZoom', instruction: 'Quick zoom that lands on a close-up as the speech begins, then holds.', useFor: 'energetic openers' },
  drift: { id: 'drift', instruction: 'Very light handheld drift.', useFor: 'explanations that need a human feel' },
  subtlePush: { id: 'subtlePush', instruction: 'Barely noticeable push from medium shot to medium close-up, then holds.', useFor: 'interview and podcast shots' },
  pullBack: { id: 'pullBack', instruction: 'Slow pull back from a close-up to reveal the surroundings, then holds.', useFor: 'revealing context or location' },
  orbit: { id: 'orbit', instruction: 'Slow half-circle orbit with the subject centred, then holds.', useFor: 'stylish transitions and silent footage' },
  walkAndTalk: { id: 'walkAndTalk', instruction: 'Camera tracks alongside the speaker as they walk toward it.', useFor: 'hooks that need momentum' },
  eyesPush: { id: 'eyesPush', instruction: 'Creeping push-in that ends tight on the eyes, then holds.', useFor: 'the emotional peak' },
  lowAngle: { id: 'lowAngle', instruction: 'Low angle looking up with a slow push, then holds.', useFor: 'authority and confidence' },
  shallowPush: { id: 'shallowPush', instruction: 'Shallow depth of field, soft background, gentle push-in, then holds.', useFor: 'premium or intimate moments' },
  slowMotion: { id: 'slowMotion', instruction: 'Slow motion with a slight drift.', useFor: 'result reveals, hair and fabric in motion' },
} as const satisfies Record<string, CameraMove>;

export type CameraMoveId = keyof typeof CAMERA_MOVES;

/** Small natural gestures; at most one before and one after the spoken line. */
export const MICRO_ACTIONS: readonly string[] = [
  'adjusts their glasses',
  'tucks hair behind one ear',
  'takes a sip of coffee and sets the cup down',
  'gives a slow nod with a small smile',
  'shrugs lightly',
  'crosses their arms',
  'gives a thumbs up',
  'tilts their head, curious',
  'taps their chin, thinking',
  'raises their eyebrows, surprised',
  'points to the empty side of the frame',
  'laughs briefly',
];

/**
 * A voice described the same way for every clip of a character. Rewording it
 * even slightly between clips makes the voice drift.
 */
export interface VoiceProfile {
  readonly gender: string;
  readonly age: string;
  readonly pitch: string;
  readonly texture: string;
  readonly delivery: string;
}

export function voiceLine(voice: VoiceProfile | string): string {
  if (typeof voice === 'string') return voice.trim();
  const parts = [voice.gender, voice.age, voice.pitch, voice.texture, voice.delivery].map((p) => p.trim());
  if (parts.some((p) => !p)) throw new InvalidInputError('A voice profile needs gender, age, pitch, texture and delivery.');
  return `${capitalize(parts[0]!)} voice, ${parts.slice(1).join(', ')}.`;
}

/** Accent goes on its own final line: language, region and register. */
export function accentLine(language: string, accent?: string): string {
  return accent
    ? `Speaks ${language} with a ${accent} accent, in a natural, informal register.`
    : `Speaks ${language} with a neutral accent, no strong regional marking.`;
}

/** Closing line that keeps the model from cutting in the middle of speech. */
export const SINGLE_TAKE = 'One continuous take: no cuts, no scene changes, the camera holds its final framing.';

export const SILENT = 'No one speaks: mouths stay closed, ambient sound only.';

/** Talking avatars lose lip-sync on long scripts; past this, prefer narration over silent footage. */
export const MAX_COMFORTABLE_TALKING_SHOTS = 6;

/** What to check in every take before delivering it. */
export const REVIEW_CHECKLIST: readonly string[] = [
  'The mouth matches the words, and only the intended person speaks.',
  'No cut or scene change in the middle of the line.',
  'The voice sounds like the same person as in the other clips.',
  'Face, hair and clothes match the base image and the other shots.',
  'Hands look natural, with the right number of fingers.',
  'Labels, packaging and screens are unchanged and readable.',
  'No stray text, captions or watermarks.',
  'The last half-second has no dissolve into another image; short clips sometimes end with one. Trim the tail in the edit if so.',
];

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
