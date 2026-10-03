import { InvalidInputError } from './errors.js';

export const FLOW_ORIGIN = 'https://flow.google.com';

/** A URL the browser is allowed to open: HTTPS on the Flow host, nothing else. */
export class FlowUrl {
  private constructor(readonly href: string) {}

  static parse(raw: string): FlowUrl {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new InvalidInputError('Not a valid URL.');
    }
    if (url.protocol !== 'https:' || url.hostname !== 'flow.google.com' || url.port !== '') {
      throw new InvalidInputError(`Only ${FLOW_ORIGIN} URLs are allowed.`);
    }
    if (url.username || url.password) {
      throw new InvalidInputError('URLs with credentials are not allowed.');
    }
    url.hash = '';
    return new FlowUrl(url.href);
  }

  static home(): FlowUrl {
    return new FlowUrl(`${FLOW_ORIGIN}/`);
  }
}
