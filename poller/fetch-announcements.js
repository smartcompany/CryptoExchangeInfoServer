/**
 * Full announcement pulls for the push poller (same public APIs as cex-fetch probes).
 */
import { createHash } from 'node:crypto';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
};

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, ...headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function hashKey(s) {
  return createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
}

export async function fetchBinanceAnnouncements(limit = 20) {
  const url = new URL(
    'https://www.binance.com/bapi/composite/v1/public/cms/article/list/query',
  );
  url.searchParams.set('type', '1');
  url.searchParams.set('catalogId', '93');
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('pageSize', String(limit));
  const body = await getJson(url, {
    Origin: 'https://www.binance.com',
    Referer: 'https://www.binance.com/en/support/announcement',
    clienttype: 'web',
    lang: 'en',
  });
  if (String(body.code) !== '000000') {
    throw new Error(body.message || 'Binance error');
  }
  const catalogs = body.data?.catalogs ?? [];
  const catalog =
    catalogs.find((c) => c.catalogId === 93) ?? catalogs[0] ?? null;
  const articles = (catalog?.articles ?? []).slice(0, limit);
  return articles.map((raw) => {
    const code = String(raw.code ?? '').trim();
    const title = String(raw.title ?? '').trim();
    return {
      id: `binance:${code || hashKey(title)}`,
      exchange: 'binance',
      title,
      url: code
        ? `https://www.binance.com/en/support/announcement/detail/${code}`
        : 'https://www.binance.com/en/support/announcement',
      tags: ['Latest Activities'],
    };
  });
}

export async function fetchBybitAnnouncements(limit = 20) {
  const url = new URL('https://api.bybit.com/v5/announcements/index');
  url.searchParams.set('locale', 'en-US');
  url.searchParams.set('type', 'latest_activities');
  url.searchParams.set('page', '1');
  url.searchParams.set('limit', String(limit));
  const body = await getJson(url);
  if (body.retCode !== 0) throw new Error(body.retMsg || 'Bybit error');
  const list = body.result?.list ?? [];
  return list.map((raw) => {
    const u = String(raw.url ?? '').trim();
    const title = String(raw.title ?? '').trim();
    const tags = (raw.tags ?? []).map(String);
    return {
      id: `bybit:${hashKey(u || `${title}:${raw.publishTime ?? ''}`)}`,
      exchange: 'bybit',
      title,
      url: u,
      tags,
    };
  });
}

export async function fetchOkxAnnouncements(limit = 20) {
  const okxHeaders = {
    Origin: 'https://www.okx.com',
    Referer: 'https://www.okx.com/help/section/announcements-latest-events',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  const typesBody = await getJson(
    'https://www.okx.com/api/v5/support/announcement-types',
    okxHeaders,
  );
  const typeIds = (typesBody.data ?? [])
    .map((t) => t?.annType)
    .filter((t) => typeof t === 'string');
  const preferred = ['latest-events', 'announcements-new-listings'];
  const annType =
    preferred.find((t) => typeIds.includes(t)) || typeIds[0] || 'latest-events';

  const url = new URL('https://www.okx.com/api/v5/support/announcements');
  url.searchParams.set('annType', annType);
  url.searchParams.set('page', '1');
  const body = await getJson(url.toString(), okxHeaders);
  if (String(body.code) !== '0') throw new Error(body.msg || 'OKX error');
  const details = (body.data?.[0]?.details ?? []).slice(0, limit);
  return details.map((raw) => {
    const u = String(raw.url ?? '').trim();
    const title = String(raw.title ?? '').trim();
    return {
      id: `okx:${hashKey(u || title)}`,
      exchange: 'okx',
      title,
      url: u || 'https://www.okx.com/help',
      tags: [String(raw.annType ?? annType)],
    };
  });
}

export async function fetchAllAnnouncements(limit = 20) {
  const labels = ['binance', 'bybit', 'okx'];
  const jobs = [
    fetchBinanceAnnouncements(limit),
    fetchBybitAnnouncements(limit),
    fetchOkxAnnouncements(limit),
  ];
  const settled = await Promise.allSettled(jobs);
  const events = [];
  const errors = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') events.push(...r.value);
    else {
      errors.push({
        exchange: labels[i],
        error: String(r.reason?.message ?? r.reason),
      });
    }
  });
  return { events, errors };
}
