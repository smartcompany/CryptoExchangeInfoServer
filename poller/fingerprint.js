import { createHash } from 'node:crypto';

/** Short hash of announcement title only. */
export function titleHash(title = '') {
  return createHash('sha1').update(String(title).trim()).digest('hex').slice(0, 16);
}

/** Seen-record key: title hash + publish date (both must match). */
export function seenKey(titleHashValue, publishedAt = '') {
  return `${titleHashValue}|${String(publishedAt).trim()}`;
}
