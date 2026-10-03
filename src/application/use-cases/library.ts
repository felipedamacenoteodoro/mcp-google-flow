import { resourceQuery } from '../../domain/library.js';
import type { Resource, ResourceCategory } from '../../domain/library.js';
import type { ResourceLibrary } from '../ports.js';

/** Finding and attaching named resources: the "@name" references of the composer. */
export class LibraryUseCases {
  constructor(private readonly library: ResourceLibrary) {}

  search(query: string | undefined, category: ResourceCategory): Promise<Resource[]> {
    return this.library.search(query === undefined || query === '' ? '' : resourceQuery(query), category);
  }

  attach(name: string, category: ResourceCategory): Promise<Resource> {
    return this.library.attach(resourceQuery(name), category);
  }
}
