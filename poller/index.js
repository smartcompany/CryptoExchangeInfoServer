import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyAnnouncement } from './classify.js';
import { fetchAllAnnouncements } from './fetch-announcements.js';
import { sendOpportunityPush } from './fcm-send.js';
import { countSeen, filterAndMarkNew, openSeenDb, seedSeen } from './seen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_DB = path.join(__dirname, '..', 'data', 'push-seen.json');

export function createPushPoller(options = {}) {
  const intervalMs = Number(
    options.intervalMs ?? process.env.PUSH_POLL_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
  );
  const dbPath = options.dbPath || process.env.PUSH_SEEN_DB || DEFAULT_DB;
  const limit = Number(options.limit ?? 20);
  const dryRun =
    options.dryRun === true ||
    String(process.env.PUSH_DRY_RUN || '').toLowerCase() === '1';

  const db = openSeenDb(dbPath);
  let timer = null;
  let running = false;
  let lastResult = null;

  async function tick() {
    if (running) return lastResult;
    running = true;
    const started = Date.now();
    try {
      const { events: raw, errors } = await fetchAllAnnouncements(limit);
      const classified = raw.map((e) => ({
        ...e,
        category: classifyAnnouncement({ title: e.title, tags: e.tags }),
      }));

      const isColdStart = countSeen(db) === 0;
      let pushed = [];
      let seeded = 0;

      if (isColdStart) {
        seeded = seedSeen(db, classified);
        lastResult = {
          ok: true,
          coldStart: true,
          seeded,
          fetched: classified.length,
          errors,
          pushed: [],
          ms: Date.now() - started,
          at: new Date().toISOString(),
        };
        console.log(
          `[push-poller] cold start: seeded ${seeded} (no push)`,
          errors.length ? errors : '',
        );
        return lastResult;
      }

      const fresh = filterAndMarkNew(db, classified);
      if (!dryRun) {
        for (const event of fresh) {
          // Skip "other" by default? Plan sends all classified; client filters via topics.
          try {
            const result = await sendOpportunityPush(event);
            pushed.push({ id: event.id, category: event.category, result });
          } catch (err) {
            pushed.push({
              id: event.id,
              category: event.category,
              result: { ok: false, error: String(err?.message ?? err) },
            });
          }
        }
      } else {
        pushed = fresh.map((e) => ({
          id: e.id,
          category: e.category,
          result: { skipped: true, reason: 'dry_run' },
        }));
      }

      lastResult = {
        ok: true,
        coldStart: false,
        fetched: classified.length,
        newCount: fresh.length,
        errors,
        pushed,
        ms: Date.now() - started,
        at: new Date().toISOString(),
      };
      if (fresh.length || errors.length) {
        console.log(
          `[push-poller] fetched=${classified.length} new=${fresh.length}`,
          errors.length ? errors : '',
        );
      }
      return lastResult;
    } catch (err) {
      lastResult = {
        ok: false,
        error: String(err?.message ?? err),
        at: new Date().toISOString(),
      };
      console.error('[push-poller] tick failed', err);
      return lastResult;
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    console.log(
      `[push-poller] starting interval=${intervalMs}ms db=${dbPath} dryRun=${dryRun}`,
    );
    // First tick shortly after boot so cold-start seed happens quickly.
    setTimeout(() => {
      tick().catch(() => {});
    }, 5_000);
    timer = setInterval(() => {
      tick().catch(() => {});
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function status() {
    return {
      intervalMs,
      dbPath,
      dryRun,
      seenCount: countSeen(db),
      lastResult,
    };
  }

  return { start, stop, tick, status };
}
