import fs from 'node:fs';
import path from 'node:path';

import { seenKey, titleHash } from './fingerprint.js';

/**
 * Seen store: title-hash + date only (no body/url/exchange).
 *
 * Shape:
 *   {
 *     "s": {
 *       "<titleHash>|<publishedAt>": { "t": "<titleHash>", "d": "<publishedAt>" }
 *     }
 *   }
 *
 * New iff no record with the same title hash AND same date.
 */
const MAX_ENTRIES = 2_000;

export function openSeenDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const store = {
    path: dbPath,
    data: { s: {} },
  };
  if (fs.existsSync(dbPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      store.data = { s: loadEntries(raw) };
    } catch {
      store.data = { s: {} };
    }
  }
  return store;
}

function loadEntries(raw) {
  const out = {};
  if (raw?.s && typeof raw.s === 'object') {
    for (const [k, v] of Object.entries(raw.s)) {
      if (v && typeof v === 'object' && v.t && v.d != null) {
        const key = seenKey(v.t, v.d);
        out[key] = { t: String(v.t), d: String(v.d) };
      } else if (typeof k === 'string' && k.includes('|')) {
        const [t, ...rest] = k.split('|');
        const d = rest.join('|');
        if (t) out[seenKey(t, d)] = { t, d };
      }
    }
  }
  return out;
}

function persist(store) {
  pruneIfNeeded(store);
  const tmp = `${store.path}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store.data), 'utf8');
  fs.renameSync(tmp, store.path);
}

function pruneIfNeeded(store) {
  const keys = Object.keys(store.data.s);
  const overflow = keys.length - MAX_ENTRIES;
  if (overflow <= 0) return;
  for (let i = 0; i < overflow; i += 1) {
    delete store.data.s[keys[i]];
  }
}

function entryFromEvent(e) {
  const t = e.titleHash || titleHash(e.title || '');
  const d = String(e.publishedAt ?? '');
  return { t, d, key: seenKey(t, d) };
}

export function countSeen(store) {
  return Object.keys(store.data.s).length;
}

export function seedSeen(store, events) {
  let n = 0;
  for (const e of events) {
    const { t, d, key } = entryFromEvent(e);
    if (!t || store.data.s[key]) continue;
    store.data.s[key] = { t, d };
    n += 1;
  }
  if (n > 0) persist(store);
  return n;
}

export function filterAndMarkNew(store, events) {
  const fresh = [];
  for (const e of events) {
    const { t, d, key } = entryFromEvent(e);
    if (!t || store.data.s[key]) continue;
    store.data.s[key] = { t, d };
    fresh.push(e);
  }
  if (fresh.length > 0) persist(store);
  return fresh;
}
