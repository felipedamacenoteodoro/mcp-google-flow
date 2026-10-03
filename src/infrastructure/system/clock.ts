import { setTimeout as delay } from 'node:timers/promises';
import type { Clock } from '../../application/ports.js';

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => delay(ms).then(() => undefined),
};
