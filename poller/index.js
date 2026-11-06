import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyAnnouncement } from './classify.js';
import { fetchAllAnnouncements } from './fetch-announcements.js';
import { sendOpportunityPush } from './fcm-send.js';
import { createLogBuffer } from './log-buffer.js';
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

function byCategory(events) {
  const out = {};
  for (const e of events) {
    const k = e.category || 'other';
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
  const log = createLogBuffer();
  let timer = null;
  let running = false;
  let lastResult = null;
  let tickCount = 0;

  async function tick() {
    if (running) {
      log.warn('tick skipped (already running)');
      return {
        ...(lastResult || { ok: false, error: 'busy' }),
        skippedBusy: true,
        log: log.snapshot(),
      };
    }
    running = true;
    tickCount += 1;
    const tickId = tickCount;
    const started = Date.now();
    const seenBefore = countSeen(db);
    log.info(`tick #${tickId} start`, {
      seen: seenBefore,
      dryRun,
      credentials: hasCredentials,
      limit,
    });

    try {
      const { events: raw, errors } = await fetchAllAnnouncements(limit);
      const classified = raw.map((e) => ({
        ...e,
        category: classifyAnnouncement({ title: e.title, tags: e.tags }),
      }));

      const exchangeCounts = byExchange(classified);
      const categoryCounts = byCategory(classified);
      log.info(`tick #${tickId} fetched ${classified.length}`, {
        byExchange: exchangeCounts,
        byCategory: categoryCounts,
        fetchErrors: errors,
      });
      if (errors.length) {
        log.warn(`tick #${tickId} some exchanges failed to fetch`, errors);
      }

      // Sample titles for dashboard debugging (not every row).
      const samples = classified.slice(0, 8).map((e) => ({
        exchange: e.exchange,
        category: e.category,
        title: String(e.title || '').slice(0, 72),
      }));
      if (samples.length) {
        log.info(`tick #${tickId} sample headlines`, samples);
      }

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
          byExchange: exchangeCounts,
          byCategory: categoryCounts,
          errors,
          pushed: [],
          ms: Date.now() - started,
          at: new Date().toISOString(),
          tickId,
          explanation:
            'Cold start: seeded seen DB only. No FCM push on first poll after empty DB.',
        };
        log.warn(
          `tick #${tickId} COLD START — seeded ${seeded}, no push (expected)`,
        );
        lastResult.log = log.snapshot();
        return lastResult;
      }

      const fresh = filterAndMarkNew(db, classified);
      log.info(`tick #${tickId} novelty check`, {
        fetched: classified.length,
        newCount: fresh.length,
        alreadySeen: classified.length - fresh.length,
        seenDb: countSeen(db),
      });

      if (fresh.length === 0) {
        log.info(
          `tick #${tickId} nothing new — all ${classified.length} announcements already in seen DB, so no FCM send`,
        );
      } else {
        log.info(
          `tick #${tickId} ${fresh.length} new item(s) to push`,
          fresh.map((e) => ({
            id: e.id,
            exchange: e.exchange,
            category: e.category,
            title: String(e.title || '').slice(0, 72),
          })),
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
              log.info(
                `sent ${event.exchange}/${event.category}`,
                {
                  id: event.id,
                  name: result.name,
                  condition: result.condition,
                  title: String(event.title || '').slice(0, 72),
                },
              );
            } else if (result.skipped) {
              log.warn(
                `skip ${event.exchange}/${event.category} reason=${result.reason}`,
                { id: event.id },
              );
            } else {
              log.error(`fail ${event.exchange}/${event.category}`, {
                id: event.id,
                error: result.error || result,
              });
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
            log.error(`fail ${event.exchange}/${event.category}`, {
              id: event.id,
              error,
            });
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
        if (fresh.length) {
          log.warn(`tick #${tickId} dryRun=true — not calling FCM`);
        }
      }

      const summary = summarizePushes(pushed);
      let explanation;
      if (fresh.length === 0) {
        explanation =
          'No new announcements vs seen DB → nothing to send. Wait for a new CEX post, or clear seen DB to re-seed (cold start again).';
      } else if (summary.sent === 0 && summary.skipped > 0) {
        explanation = `New items found but FCM skipped (${JSON.stringify(summary.skipReasons)}). Check FIREBASE_SERVICE_ACCOUNT_JSON / dryRun.`;
      } else if (summary.sent === 0 && summary.failed > 0) {
        explanation = 'New items found but FCM send failed — see log lines / pushed[].result.error.';
      } else if (summary.sent > 0) {
        explanation = `Sent ${summary.sent} FCM message(s) via topic condition. Devices must be subscribed to matching category+exchange topics.`;
      }

      lastResult = {
        ok: true,
        coldStart: false,
        fetched: classified.length,
        newCount: fresh.length,
        byExchange: exchangeCounts,
        byCategory: categoryCounts,
        ...summary,
        errors,
        pushed,
        explanation,
        ms: Date.now() - started,
        at: new Date().toISOString(),
        tickId,
      };
      log.info(`tick #${tickId} done`, {
        fetched: classified.length,
        new: fresh.length,
        sent: summary.sent,
        skipped: summary.skipped,
        failed: summary.failed,
        skipReasons: summary.skipReasons,
        seen: countSeen(db),
        ms: lastResult.ms,
      });
      lastResult.log = log.snapshot();
      return lastResult;
    } catch (err) {
      lastResult = {
        ok: false,
        error: String(err?.message ?? err),
        at: new Date().toISOString(),
        tickId,
        ms: Date.now() - started,
        explanation: 'Tick threw before completion — see error.',
      };
      log.error(`tick #${tickId} failed`, String(err?.message ?? err));
      lastResult.log = log.snapshot();
      return lastResult;
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    log.info('poller starting', {
      intervalMs,
      dbPath,
      dryRun,
      credentials: hasCredentials,
      seen: countSeen(db),
    });
    if (!hasCredentials) {
      log.warn(
        'FIREBASE_SERVICE_ACCOUNT_JSON missing — ticks run but FCM sends skip with no_credentials',
      );
    }
    setTimeout(() => {
      tick().catch((err) => {
        log.error('initial tick error', String(err?.message ?? err));
      });
    }, 5_000);
    timer = setInterval(() => {
      tick().catch((err) => {
        log.error('interval tick error', String(err?.message ?? err));
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
      lastResult: lastResult
        ? { ...lastResult, log: undefined }
        : null,
      log: log.snapshot(),
    };
  }

  return { start, stop, tick, status, log };
}
