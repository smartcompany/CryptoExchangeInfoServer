import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyAnnouncement } from './classify.js';
import { fetchAllAnnouncements } from './fetch-announcements.js';
import { sendOpportunityPush } from './fcm-send.js';
import { countSeen, filterAndMarkNew, openSeenDb, seedSeen } from './seen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_DB = path.join(__dirname, '..', 'data', 'push-seen.json');

function summarizePushes(pushed) {
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const skipReasons = {};
  for (const row of pushed) {
    const r = row.result || {};
    if (r.ok === true) sent += 1;
    else if (r.skipped) {
      skipped += 1;
      const reason = r.reason || 'unknown';
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
    } else failed += 1;
  }
  return { sent, skipped, failed, skipReasons };
}

function byExchange(events) {
  const out = {};
  for (const e of events) {
    const k = e.exchange || 'unknown';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

export function createPushPoller(options = {}) {
  const intervalMs = Number(
    options.intervalMs ?? process.env.PUSH_POLL_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
  );
  const dbPath = options.dbPath || process.env.PUSH_SEEN_DB || DEFAULT_DB;
  const limit = Number(options.limit ?? 20);
  const dryRun =
    options.dryRun === true ||
    String(process.env.PUSH_DRY_RUN || '').toLowerCase() === '1';
  const hasCredentials = Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim(),
  );

  const db = openSeenDb(dbPath);
  let timer = null;
  let running = false;
  let lastResult = null;
  let tickCount = 0;

  async function tick() {
    if (running) {
      console.log('[push-poller] tick skipped (already running)');
      return lastResult;
    }
    running = true;
    tickCount += 1;
    const tickId = tickCount;
    const started = Date.now();
    console.log(
      `[push-poller] tick #${tickId} start seen=${countSeen(db)} dryRun=${dryRun} credentials=${hasCredentials}`,
    );

    try {
      const { events: raw, errors } = await fetchAllAnnouncements(limit);
      const classified = raw.map((e) => ({
        ...e,
        category: classifyAnnouncement({ title: e.title, tags: e.tags }),
      }));

      console.log(
        `[push-poller] tick #${tickId} fetched=${classified.length} byExchange=${JSON.stringify(byExchange(classified))}${
          errors.length ? ` fetchErrors=${JSON.stringify(errors)}` : ''
        }`,
      );

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
          tickId,
        };
        console.log(
          `[push-poller] tick #${tickId} cold start seeded=${seeded} seen=${countSeen(db)} ms=${lastResult.ms} (no push)`,
        );
        return lastResult;
      }

      const fresh = filterAndMarkNew(db, classified);
      if (fresh.length) {
        console.log(
          `[push-poller] tick #${tickId} new=${fresh.length} ids=${fresh
            .map((e) => `${e.exchange}/${e.category}`)
            .join(',')}`,
        );
      }

      if (!dryRun) {
        for (const event of fresh) {
          try {
            const result = await sendOpportunityPush(event);
            pushed.push({
              id: event.id,
              exchange: event.exchange,
              category: event.category,
              title: String(event.title || '').slice(0, 80),
              result,
            });
            if (result.ok) {
              console.log(
                `[push-poller] sent ${event.exchange}/${event.category} id=${event.id} name=${result.name || ''}`,
              );
            } else if (result.skipped) {
              console.log(
                `[push-poller] skip ${event.exchange}/${event.category} id=${event.id} reason=${result.reason}`,
              );
            } else {
              console.error(
                `[push-poller] fail ${event.exchange}/${event.category} id=${event.id}`,
                result.error || result,
              );
            }
          } catch (err) {
            const error = String(err?.message ?? err);
            pushed.push({
              id: event.id,
              exchange: event.exchange,
              category: event.category,
              title: String(event.title || '').slice(0, 80),
              result: { ok: false, error },
            });
            console.error(
              `[push-poller] fail ${event.exchange}/${event.category} id=${event.id}`,
              error,
            );
          }
        }
      } else {
        pushed = fresh.map((e) => ({
          id: e.id,
          exchange: e.exchange,
          category: e.category,
          title: String(e.title || '').slice(0, 80),
          result: { skipped: true, reason: 'dry_run' },
        }));
      }

      const summary = summarizePushes(pushed);
      lastResult = {
        ok: true,
        coldStart: false,
        fetched: classified.length,
        newCount: fresh.length,
        ...summary,
        errors,
        pushed,
        ms: Date.now() - started,
        at: new Date().toISOString(),
        tickId,
      };
      console.log(
        `[push-poller] tick #${tickId} done fetched=${classified.length} new=${fresh.length} sent=${summary.sent} skipped=${summary.skipped} failed=${summary.failed} seen=${countSeen(db)} ms=${lastResult.ms}${
          summary.skipped
            ? ` skipReasons=${JSON.stringify(summary.skipReasons)}`
            : ''
        }${errors.length ? ` fetchErrors=${JSON.stringify(errors)}` : ''}`,
      );
      return lastResult;
    } catch (err) {
      lastResult = {
        ok: false,
        error: String(err?.message ?? err),
        at: new Date().toISOString(),
        tickId,
        ms: Date.now() - started,
      };
      console.error(`[push-poller] tick #${tickId} failed`, err);
      return lastResult;
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    console.log(
      `[push-poller] starting interval=${intervalMs}ms db=${dbPath} dryRun=${dryRun} credentials=${hasCredentials} seen=${countSeen(db)}`,
    );
    if (!hasCredentials) {
      console.warn(
        '[push-poller] FIREBASE_SERVICE_ACCOUNT_JSON missing — ticks will run but FCM sends will be skipped',
      );
    }
    // First tick shortly after boot so cold-start seed happens quickly.
    setTimeout(() => {
      tick().catch((err) => {
        console.error('[push-poller] initial tick error', err);
      });
    }, 5_000);
    timer = setInterval(() => {
      tick().catch((err) => {
        console.error('[push-poller] interval tick error', err);
      });
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
      hasCredentials,
      seenCount: countSeen(db),
      tickCount,
      lastResult,
    };
  }

  return { start, stop, tick, status };
}
