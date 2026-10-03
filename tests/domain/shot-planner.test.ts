import { describe, expect, it } from 'vitest';
import { ShotPlanningUseCases } from '../../src/application/use-cases/shot-planning.js';
import { accentLine, SINGLE_TAKE, voiceLine } from '../../src/domain/craft.js';
import { InvalidInputError } from '../../src/domain/errors.js';
import { DEFAULT_STYLES, LAYOUTS, planShots, splitToFit } from '../../src/domain/shot-planner.js';

const anaVoice = { gender: 'female', age: 'mid-30s', pitch: 'medium pitch', texture: 'smooth', delivery: 'warm and confident' };
const ana = { name: 'Ana', description: 'a woman in her 30s with curly dark hair and a green blouse', resource: 'Ana', voice: anaVoice };
const leo = { name: 'Leo', description: 'a bald man in his 50s wearing glasses and a navy sweater', resource: 'Leo', voice: 'Male voice, 50s, low and gravelly, calm.' };
const base = { setting: 'a bright coffee shop', language: 'Brazilian Portuguese', shotSeconds: 8 as const };
const solo = DEFAULT_STYLES.solo;
const duo = DEFAULT_STYLES['two-in-frame'];
const alternating = DEFAULT_STYLES.alternating;
const narration = DEFAULT_STYLES.narration;

describe('splitToFit', () => {
  it('gives every sentence its own shot', () => {
    expect(splitToFit('Você sabia? Dá para provar hoje.', 18)).toEqual(['Você sabia?', 'Dá para provar hoje.']);
  });

  it('splits a sentence that does not fit at word boundaries', () => {
    const words = Array.from({ length: 25 }, (_, i) => `w${i}`).join(' ');
    const chunks = splitToFit(words, 10);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.split(' ').length <= 10)).toBe(true);
  });
});

describe('craft', () => {
  it('builds the same voice line every time', () => {
    expect(voiceLine(anaVoice)).toBe('Female voice, mid-30s, medium pitch, smooth, warm and confident.');
    expect(() => voiceLine({ ...anaVoice, pitch: ' ' })).toThrow(InvalidInputError);
  });

  it('states the accent on its own line', () => {
    expect(accentLine('Brazilian Portuguese', 'São Paulo')).toContain('São Paulo accent');
    expect(accentLine('Brazilian Portuguese')).toContain('neutral accent');
  });
});

describe('planShots', () => {
  it('orders each prompt: scene, camera, gesture, line, voice, accent, single take', () => {
    const plan = planShots({ ...base, style: solo, cast: [ana], script: 'Ana: [adjusts her glasses] Você sabia disso? [smiles]' });
    const prompt = plan.shots[0]!.prompt;
    const order = ['looking into the lens', 'Camera:', 'The speaker adjusts her glasses, then says: "Você sabia disso?"', 'After the line, the speaker smiles.', 'Voice: Female voice', 'Speaks Brazilian Portuguese', SINGLE_TAKE];
    const positions = order.map((part) => prompt.indexOf(part));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('picks the camera from the shot role: hook, key line, call to action', () => {
    const plan = planShots({ ...base, style: solo, cast: [ana], script: 'Primeira frase.\nSegunda frase.\n* A frase-chave.\nChama para ação.' });
    expect(plan.shots.map((s) => s.role)).toEqual(['hook', 'body', 'key-line', 'call-to-action']);
    expect(plan.shots[0]!.camera).toContain('zoom');
    expect(plan.shots[2]!.camera).toContain('Tripod-locked');
    expect(plan.shots[3]!.camera).toContain('Slow continuous zoom');
  });

  it('reads gesture and key-line markers in either order', () => {
    for (const script of ['Ana: [smiles] * Não precisa esperar.', 'Ana: * [smiles] Não precisa esperar.']) {
      const shot = planShots({ ...base, style: solo, cast: [ana], script }).shots[0]!;
      expect(shot.line).toBe('Não precisa esperar.');
      expect(shot.role).toBe('key-line');
      expect(shot.prompt).toContain('The speaker smiles, then says: "Não precisa esperar."');
      expect(shot.prompt).not.toMatch(/\bThey says\b|\bthey smiles\b/);
    }
  });

  it('keeps the listener silent and names the speaker by side with two people in frame', () => {
    const plan = planShots({ ...base, style: duo, cast: [ana, { ...leo, position: 'left' as const }], script: 'Leo: Isso muda tudo.' });
    const prompt = plan.shots[0]!.prompt;
    expect(prompt).toContain(`on the left, ${leo.description}`);
    expect(prompt).toContain('The person on the left speaks. The person on the right only listens');
    expect(prompt).toContain('mouth closed');
    expect(prompt).toContain('never cut to a shot of one person alone');
    expect(prompt).toContain('Tripod-locked');
    expect(prompt).toContain('Voice: Male voice');
    expect(prompt).not.toContain('Female voice');
    expect(plan.shots[0]!.attachResources).toEqual(['Ana', 'Leo']);
  });

  it('animates every shot from the base image in frames mode', () => {
    const plan = planShots({ ...base, style: duo, cast: [ana, leo], baseImage: 'ana-and-leo', script: 'Ana: Oi.\nLeo: Olá.' });
    expect(plan.mode).toBe('frames');
    expect(plan.shots.every((s) => s.startFrame === 'ana-and-leo' && s.attachResources.length === 0)).toBe(true);
    expect(plan.warnings.join(' ')).not.toMatch(/base_image/);
  });

  it('warns when two people share the frame without a base image', () => {
    const plan = planShots({ ...base, style: duo, cast: [ana, leo], script: 'Ana: Oi.' });
    expect(plan.mode).toBe('video');
    expect(plan.warnings.join(' ')).toMatch(/base_image/);
  });

  it('refuses two people on the same side of the frame', () => {
    expect(() =>
      planShots({ ...base, style: duo, cast: [{ ...ana, position: 'left' as const }, { ...leo, position: 'left' as const }], script: 'Ana: oi' }),
    ).toThrow(/different positions/);
  });

  it('shows alternating speakers alone, looking toward the other person', () => {
    const plan = planShots({ ...base, style: alternating, cast: [ana, leo], script: 'Ana: Pergunta.\nLeo: Resposta.' });
    expect(plan.shots.map((s) => s.speaker)).toEqual(['Ana', 'Leo']);
    expect(plan.shots[1]!.prompt).toContain('alone in the frame, looking slightly off to the side');
    expect(plan.shots[1]!.attachResources).toEqual(['Leo']);
  });

  it('writes narration shots silent, without voice or accent', () => {
    const plan = planShots({ ...base, style: narration, cast: [], script: 'Uma cidade acordando.' });
    const prompt = plan.shots[0]!.prompt;
    expect(plan.shots[0]!.speaker).toBeNull();
    expect(prompt).toContain('No one speaks');
    expect(prompt).not.toContain('Voice:');
    expect(prompt).not.toContain('Speaks ');
  });

  it('warns about missing voices and long talking scripts', () => {
    const script = Array.from({ length: 8 }, (_, i) => `Frase ${i}.`).join('\n');
    const plan = planShots({ ...base, style: solo, cast: [{ ...ana, voice: undefined }], script });
    expect(plan.warnings.join(' ')).toMatch(/lip-sync/);
    expect(plan.warnings.join(' ')).toMatch(/no voice description/);
  });

  it('rejects unknown speakers, missing cast, misplaced gestures and oversized scripts', () => {
    expect(() => planShots({ ...base, style: alternating, cast: [ana, leo], script: 'Bia: oi' })).toThrow(/not in the cast/);
    expect(() => planShots({ ...base, style: duo, cast: [ana], script: 'Ana: oi' })).toThrow(InvalidInputError);
    expect(() => planShots({ ...base, style: solo, cast: [ana], script: 'Olá [acena] mundo.' })).toThrow(/start or end/);
    const long = Array.from({ length: 21 }, (_, i) => `Frase ${i}.`).join('\n');
    expect(() => planShots({ ...base, style: solo, cast: [ana], script: long })).toThrow(/limit is 20/);
  });

  it.each(LAYOUTS)('plans a short script with the %s layout', (layout) => {
    const script = layout === 'narration' ? 'Primeira cena.\nSegunda cena.' : layout === 'solo' ? 'Primeira.\nSegunda.' : 'Ana: Primeira.\nLeo: Segunda.';
    const plan = planShots({ ...base, style: DEFAULT_STYLES[layout], cast: [ana, leo], script });
    expect(plan.shots).toHaveLength(2);
  });
});

describe('ShotPlanningUseCases', () => {
  const planning = new ShotPlanningUseCases();

  it('lets the caller override framings, camera and rules', () => {
    const plan = planning.plan({
      ...base,
      layout: 'solo',
      cast: [ana],
      script: 'Ana: Oi.\nAna: Tchau.',
      framings: ['full-body shot'],
      camera: { hook: 'orbit' },
      rules: ['Always outdoors.'],
      aspect: '16:9',
    });
    expect(plan.aspect).toBe('16:9');
    expect(plan.shots[0]!.framing).toBe('full-body shot');
    expect(plan.shots[0]!.camera).toContain('orbit');
    expect(plan.shots[1]!.camera).toContain('zoom');
    expect(plan.rules).toContain('Always outdoors.');
  });

  it('rejects unsupported shot durations', () => {
    expect(() => planning.plan({ ...base, layout: 'solo', cast: [ana], script: 'Oi.', shotSeconds: 5 })).toThrow(InvalidInputError);
  });

  it('exposes the directing toolkit', () => {
    const guide = planning.guide();
    expect(guide.layouts.map((l) => l.layout)).toEqual([...LAYOUTS]);
    expect(guide.cameraMoves.length).toBeGreaterThan(10);
    expect(guide.reviewChecklist.length).toBeGreaterThan(5);
  });
});
