import fs from 'node:fs';
import path from 'node:path';

/**
 * Simple file-backed seen set (no native deps).
 * Shape: { ids: { [id]: { exchange, category, title, url, first_seen_at } } }
 */
export function openSeenDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const store = {
    path: dbPath,
    data: { ids: {} },
  };
  if (fs.existsSync(dbPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      store.data = {
        ids:
          raw && typeof raw.ids === 'object' && raw.ids !== null
            ? raw.ids
            : {},
      };
    } catch {
      store.data = { ids: {} };
    }
  }
  return store;
}

function persist(store) {
  const tmp = `${store.path}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store.data), 'utf8');
  fs.renameSync(tmp, store.path);
}

export function countSeen(store) {
  return Object.keys(store.data.ids).length;
}

export function seedSeen(store, events) {
  const now = new Date().toISOString();
  let n = 0;
  for (const e of events) {
    if (store.data.ids[e.id]) continue;
    store.data.ids[e.id] = {
      exchange: e.exchange,
      category: e.category || 'other',
      title: e.title || '',
      url: e.url || '',
      first_seen_at: now,
    };
    n += 1;
  }
  if (n > 0) persist(store);
  return n;
}

export function filterAndMarkNew(store, events) {
  const now = new Date().toISOString();
  const fresh = [];
  for (const e of events) {
    if (store.data.ids[e.id]) continue;
    store.data.ids[e.id] = {
      exchange: e.exchange,
      category: e.category || 'other',
      title: e.title || '',
      url: e.url || '',
      first_seen_at: now,
    };
    fresh.push(e);
  }
  if (fresh.length > 0) persist(store);
  return fresh;
}
