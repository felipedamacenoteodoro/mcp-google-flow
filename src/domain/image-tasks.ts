import { InvalidInputError } from './errors.js';

/**
 * Image jobs that prepare or vary the base image a video is animated from.
 * Each task knows which details it needs, how many reference images to
 * attach, and writes the prompt(s) so identity, packaging and hands survive.
 */
export const IMAGE_TASK_IDS = [
  'avatar',
  'identity-sheet',
  'outfit-background',
  'look',
  'angle',
  'product-in-hand',
  'app-screen',
  'before-after',
  'swap-person',
] as const;
export type ImageTaskId = (typeof IMAGE_TASK_IDS)[number];

export interface ImageTaskDetails {
  /** Who the person is: age, look, vibe (avatar, swap-person). */
  who?: string;
  setting?: string;
  framing?: string;
  mood?: string;
  /** The single thing to change (outfit-background, look). */
  change?: string;
  /** A second reference supplies the change (e.g. the outfit). */
  fromSecondImage?: boolean;
  angle?: string;
  /** How the product or phone is held. */
  how?: string;
  /** app-screen: 1 = phone with a black screen, 2 = place the screenshot. */
  step?: number;
  before?: string;
  after?: string;
}

export interface ImageTaskPlan {
  readonly task: ImageTaskId;
  readonly aspect: '9:16' | '1:1';
  /** One prompt per image to generate, in order. */
  readonly prompts: string[];
  /** What to attach, in order, as references. */
  readonly attach: string[];
  readonly notes: string[];
}

export const ANGLES: Readonly<Record<string, string>> = {
  high: 'a high angle looking down at them',
  low: 'a low angle looking up at them',
  overhead: 'directly overhead',
  ground: 'ground level, looking slightly up',
  backlit: 'behind a strong light source, as a backlit silhouette with a soft rim of light',
  tilted: 'a tilted, dutch-angle frame',
  wide: 'a wide shot that shows the whole environment around them',
  profile: 'the side, in profile',
};

const PHOTO_LOOK =
  'Realistic smartphone photo: natural light, visible skin pores and small imperfections, slight grain, casual composition.';
const CLEAN = 'No text, no watermark, no distortion.';
const SAME_PERSON = 'Same person as in the first attached image: identical face, features and identity.';
const HANDS = 'Realistic hands with five fingers each, holding naturally.';

export function describeImageTask(task: ImageTaskId): { needs: string[]; attach: string[]; summary: string } {
  return TASKS[task].info;
}

export function planImageTask(task: ImageTaskId, details: ImageTaskDetails): ImageTaskPlan {
  const definition = TASKS[task];
  for (const field of definition.required) {
    const value = details[field];
    if (value === undefined || (typeof value === 'string' && value.trim() === '')) {
      throw new InvalidInputError(`Task "${task}" needs "${field}". It needs: ${definition.info.needs.join('; ')}.`);
    }
  }
  const text = (value: string | undefined) => (value ?? '').trim();
  return { task, ...definition.build(details, text) };
}

interface TaskDefinition {
  info: { summary: string; needs: string[]; attach: string[] };
  required: (keyof ImageTaskDetails)[];
  build: (d: ImageTaskDetails, t: (v: string | undefined) => string) => Omit<ImageTaskPlan, 'task'>;
}

const TASKS: Record<ImageTaskId, TaskDefinition> = {
  avatar: {
    info: {
      summary: 'Creates a realistic person to use as the base of the videos.',
      needs: ['who (age, gender, look, clothes)', 'setting', 'framing (optional)', 'mood (optional)'],
      attach: [],
    },
    required: ['who', 'setting'],
    build: (d, t) => ({
      aspect: '9:16',
      prompts: [
        `Vertical photo of ${t(d.who)}, ${t(d.framing) || 'medium close-up, looking into the lens'}, in ${t(d.setting)}.` +
          `${d.mood ? ` ${t(d.mood)}.` : ''} ${PHOTO_LOOK} ${CLEAN}`,
      ],
      attach: [],
      notes: ['Generate 2-4 variants and pick the most natural face; that image becomes the base of every clip.'],
    }),
  },
  'identity-sheet': {
    info: {
      summary: 'Nine views of the same face, used as a reference to keep the character identical.',
      needs: ['the person image to attach', 'who (only when the image has more than one person, e.g. "the woman on the left")'],
      attach: ['the person'],
    },
    required: [],
    build: (d, t) => ({
      aspect: '1:1',
      prompts: [
        `Character reference sheet. ${d.who ? `Only ${t(d.who)} from the attached image, with the identical face, features and identity.` : SAME_PERSON} Nine views in a 3x3 grid: front, left profile, right profile, ` +
          'left three-quarter, right three-quarter, looking up, looking down, smiling, serious. ' +
          `Plain light-grey background, even flat lighting, no beautifying and no skin smoothing. ${CLEAN}`,
      ],
      attach: ['the person'],
      notes: [
        'When you later use the sheet as a reference, say that the scene comes from the first image and only the face from the sheet, and forbid copying its grid, background or poses.',
      ],
    }),
  },
  'outfit-background': {
    info: {
      summary: 'Changes the outfit and/or the background while keeping the person identical.',
      needs: ['change (e.g. "a navy blazer" or "a modern kitchen")', 'fromSecondImage=true when a second image supplies it'],
      attach: ['the person', 'optional: the outfit or place'],
    },
    required: ['change'],
    build: (d, t) => ({
      aspect: '9:16',
      prompts: [
        `${SAME_PERSON} Change only this: ${t(d.change)}.` +
          (d.fromSecondImage ? ' Take it from the second attached image; the face comes only from the first image.' : '') +
          ` Keep pose, expression, hair and lighting identical. ${PHOTO_LOOK} ${CLEAN}`,
      ],
      attach: d.fromSecondImage ? ['the person', 'the outfit or place'] : ['the person'],
      notes: ['One change per image. For outfit and background, make two passes.'],
    }),
  },
  look: {
    info: {
      summary: 'Changes one aspect of the appearance (hair, glasses, makeup, age) keeping the identity.',
      needs: ['change (e.g. "short hair", "reading glasses", "ten years older")'],
      attach: ['the person'],
    },
    required: ['change'],
    build: (d, t) => ({
      aspect: '9:16',
      prompts: [`${SAME_PERSON} Change only this: ${t(d.change)}. Everything else stays exactly the same. ${PHOTO_LOOK} ${CLEAN}`],
      attach: ['the person'],
      notes: [],
    }),
  },
  angle: {
    info: {
      summary: 'The same person and scene seen from a new camera angle, to vary the edit.',
      needs: [`angle: one of ${Object.keys(ANGLES).join(', ')}`],
      attach: ['the person in the scene'],
    },
    required: ['angle'],
    build: (d, t) => {
      const angle = ANGLES[t(d.angle)];
      if (!angle) throw new InvalidInputError(`angle must be one of: ${Object.keys(ANGLES).join(', ')}.`);
      return {
        aspect: '9:16',
        prompts: [`${SAME_PERSON} Same clothes, same place and same moment, now seen from ${angle}. ${PHOTO_LOOK} ${CLEAN}`],
        attach: ['the person in the scene'],
        notes: ['Changing the angle is the cheapest way to make A/B variants without changing the person.'],
      };
    },
  },
  'product-in-hand': {
    info: {
      summary: 'The person holds the product; packaging and label stay exactly as in the product photo.',
      needs: ['how it is held (optional)'],
      attach: ['the person', 'the product'],
    },
    required: [],
    build: (d, t) => ({
      aspect: '9:16',
      prompts: [
        `${SAME_PERSON} They hold the product from the second attached image ${t(d.how) || 'at chest height, label facing the camera'}. ` +
          `The product's shape, colours, packaging and label stay exactly as in the second image. ${HANDS} ${PHOTO_LOOK} ${CLEAN}`,
      ],
      attach: ['the person', 'the product'],
      notes: ['Check the label in the still before animating it; regenerate if any letter changed.'],
    }),
  },
  'app-screen': {
    info: {
      summary: 'Puts a real app screenshot on a phone the person holds, in two steps.',
      needs: ['step: 1 (phone with a black screen) or 2 (place the screenshot)', 'how the phone is held (optional)'],
      attach: ['step 1: the person', 'step 2: the step-1 image, then the screenshot'],
    },
    required: ['step'],
    build: (d, t) => {
      if (d.step === 1) {
        return {
          aspect: '9:16',
          prompts: [
            `${SAME_PERSON} They hold a smartphone ${t(d.how) || 'toward the camera'}, screen facing the viewer; ` +
              `the screen is completely black and blank. ${HANDS} ${PHOTO_LOOK} ${CLEAN}`,
          ],
          attach: ['the person'],
          notes: ['A blank screen first keeps the model from inventing an interface. Then run step 2.'],
        };
      }
      if (d.step === 2) {
        return {
          aspect: '9:16',
          prompts: [
            'Place the second attached image (an app screenshot) on the phone screen of the first image, matching the ' +
              "screen's perspective and corners, keeping the screenshot's aspect ratio, with a subtle glass reflection. " +
              `Change nothing else. ${CLEAN}`,
          ],
          attach: ['the step-1 image', 'the screenshot'],
          notes: [],
        };
      }
      throw new InvalidInputError('step must be 1 or 2.');
    },
  },
  'before-after': {
    info: {
      summary: 'Two images of the same person, before and after, from one base image.',
      needs: ['before (the problem state)', 'after (the result state)'],
      attach: ['the person'],
    },
    required: ['before', 'after'],
    build: (d, t) => ({
      aspect: '9:16',
      prompts: [
        `${SAME_PERSON} Before: ${t(d.before)}. ${PHOTO_LOOK} ${CLEAN}`,
        `${SAME_PERSON} After: ${t(d.after)}. Different outfit and hairstyle from the before image, to show that time has passed. ${PHOTO_LOOK} ${CLEAN}`,
      ],
      attach: ['the person'],
      notes: ['Generate both from the same base image so the face matches.'],
    }),
  },
  'swap-person': {
    info: {
      summary: 'A genuinely different person in the same pose, place and light.',
      needs: ['who (the new person)'],
      attach: ['the current image'],
    },
    required: ['who'],
    build: (d, t) => ({
      aspect: '9:16',
      prompts: [`A different person, ${t(d.who)}, in exactly the same pose, place, framing and lighting as the attached image. ${PHOTO_LOOK} ${CLEAN}`],
      attach: ['the current image'],
      notes: ['A new face means every video clip must be regenerated from the new image.'],
    }),
  },
};

/** General advice shown with each image job; `tasks` limits a tip to the jobs it helps. */
const IMAGE_TIPS: ReadonlyArray<{ tip: string; tasks?: readonly ImageTaskId[] }> = [
  { tip: 'Animate every video clip from one base image; that image is what keeps the face steady.' },
  { tip: 'For a recurring character, make an identity sheet and keep it as a reference.', tasks: ['avatar', 'identity-sheet'] },
  { tip: 'Every image edit restates that it is the same person with the same face, changes one thing only, and locks the rest.' },
  { tip: 'With two reference images, say which one supplies what (e.g. outfit from the second, face from the first).', tasks: ['outfit-background', 'product-in-hand', 'app-screen'] },
  { tip: 'Describe images like phone photos (grain, visible pores, small imperfections); avoid words like AI, CGI or render.' },
  { tip: 'Check labels, packaging and screens in the still before animating it.', tasks: ['product-in-hand', 'app-screen'] },
  { tip: 'Changing the angle or the outfit is cheaper than changing the person.', tasks: ['angle', 'outfit-background', 'look', 'swap-person'] },
];

export function imageTipsFor(task: ImageTaskId): string[] {
  return IMAGE_TIPS.filter((t) => !t.tasks || t.tasks.includes(task)).map((t) => t.tip);
}
