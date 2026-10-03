import { InvalidInputError } from './errors.js';

/** Tabs of Flow's resource picker (the "+" button, also opened by typing "@"). */
export const RESOURCE_CATEGORIES = ['all', 'images', 'videos', 'voices', 'characters', 'avatars', 'uploads'] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

/** Anything the composer can reference by name: media, voices, characters, avatars. */
export interface Resource {
  readonly name: string;
  readonly kind: string;
}

export interface ProjectSummary {
  readonly id: string;
  readonly url: string;
}

const MAX_NAME = 120;

/** A resource name or search term as typed into the picker's search box. */
export function resourceQuery(raw: string): string {
  const value = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (value.length === 0 || value.length > MAX_NAME) {
    throw new InvalidInputError(`Resource names must have 1 to ${MAX_NAME} characters.`);
  }
  return value;
}
