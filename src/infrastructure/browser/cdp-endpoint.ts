import { InvalidInputError } from '../../domain/errors.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The DevTools port gives full control of a signed-in browser. Only accept an
 * endpoint on this machine's loopback interface, never a LAN or remote host.
 */
export function loopbackEndpoint(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvalidInputError('CDP endpoint is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'ws:') {
    throw new InvalidInputError('CDP endpoint must use http:// or ws://.');
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new InvalidInputError('CDP endpoint must be on loopback (127.0.0.1, localhost or ::1).');
  }
  if (url.username || url.password) {
    throw new InvalidInputError('CDP endpoint must not carry credentials.');
  }
  return url.href.replace(/\/$/, '');
}
