import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../../src/domain/errors.js';
import { IMAGE_TASK_IDS, imageTipsFor, planImageTask } from '../../src/domain/image-tasks.js';

describe('image tasks', () => {
  it('creates an avatar as a natural phone photo', () => {
    const plan = planImageTask('avatar', { who: 'a barista in her 30s, curly dark hair', setting: 'a bright coffee shop' });
    expect(plan.aspect).toBe('9:16');
    expect(plan.attach).toEqual([]);
    expect(plan.prompts[0]).toContain('a barista in her 30s');
    expect(plan.prompts[0]).toContain('No text, no watermark');
  });

  it('builds a nine-view identity sheet that keeps the face', () => {
    const plan = planImageTask('identity-sheet', {});
    expect(plan.aspect).toBe('1:1');
    expect(plan.prompts[0]).toMatch(/Nine views in a 3x3 grid/);
    expect(plan.prompts[0]).toMatch(/identical face/);
    expect(plan.notes.join(' ')).toMatch(/forbid copying its grid/);
    expect(planImageTask('identity-sheet', { who: 'the man on the right' }).prompts[0]).toContain('Only the man on the right');
  });

  it('changes one thing and says which image supplies it', () => {
    const plan = planImageTask('outfit-background', { change: 'a navy blazer', fromSecondImage: true });
    expect(plan.attach).toEqual(['the person', 'the outfit or place']);
    expect(plan.prompts[0]).toContain('face comes only from the first image');
  });

  it('locks the product label and asks for realistic hands', () => {
    const prompt = planImageTask('product-in-hand', {}).prompts[0]!;
    expect(prompt).toContain('label stay exactly as in the second image');
    expect(prompt).toContain('five fingers');
  });

  it('puts an app on screen in two steps, black screen first', () => {
    expect(planImageTask('app-screen', { step: 1 }).prompts[0]).toContain('completely black and blank');
    expect(planImageTask('app-screen', { step: 2 }).attach).toEqual(['the step-1 image', 'the screenshot']);
    expect(() => planImageTask('app-screen', { step: 3 })).toThrow(InvalidInputError);
  });

  it('makes before and after from the same base, with a visible passage of time', () => {
    const plan = planImageTask('before-after', { before: 'tired, messy desk', after: 'relaxed, tidy desk' });
    expect(plan.prompts).toHaveLength(2);
    expect(plan.prompts[1]).toContain('time has passed');
  });

  it('rejects missing details and unknown angles', () => {
    expect(() => planImageTask('avatar', { who: 'someone' })).toThrow(/needs "setting"/);
    expect(() => planImageTask('angle', { angle: 'fisheye' })).toThrow(InvalidInputError);
    expect(planImageTask('angle', { angle: 'low' }).prompts[0]).toContain('low angle');
  });

  it('covers every task id', () => {
    const minimal: Record<string, object> = {
      avatar: { who: 'x', setting: 'y' }, 'outfit-background': { change: 'x' }, look: { change: 'x' }, angle: { angle: 'high' },
      'app-screen': { step: 1 }, 'before-after': { before: 'a', after: 'b' }, 'swap-person': { who: 'x' },
    };
    for (const task of IMAGE_TASK_IDS) expect(planImageTask(task, minimal[task] ?? {}).prompts.length).toBeGreaterThan(0);
  });
});

describe('image tips', () => {
  it('shows product and screen advice only for those jobs', () => {
    expect(imageTipsFor('product-in-hand').join(' ')).toMatch(/labels, packaging and screens/);
    expect(imageTipsFor('avatar').join(' ')).not.toMatch(/labels, packaging/);
  });
});
