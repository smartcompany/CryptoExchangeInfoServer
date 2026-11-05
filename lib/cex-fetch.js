/**
 * Server-side CEX announcement probes (same public URLs as Flutter fetchers).
 * Used to verify Railway (or any host) can reach Binance / Bybit.
 */

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
};

/**
 * @param {string} url
 * @param {Record<string, string>} [extraHeaders]
 */
async function fetchJson(url, extraHeaders = {}) {
  const started = Date.now();
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, ...extraHeaders },
    signal: AbortSignal.timeout(20_000),
  });
  const latencyMs = Date.now() - started;
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, latencyMs, text, body };
}

export async function probeBinance() {
  const url =
    'https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=93&pageNo=1&pageSize=3';
  try {
    const { status, latencyMs, text, body } = await fetchJson(url, {
      Origin: 'https://www.binance.com',
      Referer: 'https://www.binance.com/en/support/announcement',
      clienttype: 'web',
      lang: 'en',
    });
    const codeOk = String(body?.code ?? '') === '000000';
    const catalogs = body?.data?.catalogs ?? [];
    const catalog =
      catalogs.find((c) => c.catalogId === 93) ?? catalogs[0] ?? null;
    const articles = catalog?.articles ?? [];
    const sample = articles[0];
    return {
      exchange: 'binance',
      ok: status === 200 && codeOk,
      httpStatus: status,
      latencyMs,
      apiCode: body?.code ?? null,
      articleCount: articles.length,
      sampleTitle: sample?.title ?? null,
      sampleCode: sample?.code ?? null,
      error: codeOk
        ? null
        : body?.message ||
          (status !== 200 ? `HTTP ${status}` : 'unexpected body') ||
          clip(text, 200),
    };
  } catch (error) {
    return {
      exchange: 'binance',
      ok: false,
      httpStatus: null,
      latencyMs: null,
      apiCode: null,
      articleCount: 0,
      sampleTitle: null,
      sampleCode: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function probeBybit() {
  const url =
    'https://api.bybit.com/v5/announcements/index?locale=en-US&type=latest_activities&page=1&limit=3';
  try {
    const { status, latencyMs, text, body } = await fetchJson(url);
    const codeOk = body?.retCode === 0;
    const list = body?.result?.list ?? [];
    const sample = list[0];
    return {
      exchange: 'bybit',
      ok: status === 200 && codeOk,
      httpStatus: status,
      latencyMs,
      apiCode: body?.retCode ?? null,
      articleCount: list.length,
      sampleTitle: sample?.title ?? null,
      sampleUrl: sample?.url ?? null,
      error: codeOk
        ? null
        : body?.retMsg ||
          (status !== 200 ? `HTTP ${status}` : 'unexpected body') ||
          clip(text, 200),
    };
  } catch (error) {
    return {
      exchange: 'bybit',
      ok: false,
      httpStatus: null,
      latencyMs: null,
      apiCode: null,
      articleCount: 0,
      sampleTitle: null,
      sampleUrl: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function probeOkx() {
  const url =
    'https://www.okx.com/api/v5/support/announcements?annType=latest-events&page=1';
  try {
    const { status, latencyMs, text, body } = await fetchJson(url, {
      'Accept-Language': 'en-US',
    });
    const codeOk = String(body?.code ?? '') === '0';
    const details = body?.data?.[0]?.details ?? [];
    const sample = details[0];
    return {
      exchange: 'okx',
      ok: status === 200 && codeOk,
      httpStatus: status,
      latencyMs,
      apiCode: body?.code ?? null,
      articleCount: details.length,
      sampleTitle: sample?.title ?? null,
      sampleUrl: sample?.url ?? null,
      error: codeOk
        ? null
        : body?.msg ||
          (status !== 200 ? `HTTP ${status}` : 'unexpected body') ||
          clip(text, 200),
    };
  } catch (error) {
    return {
      exchange: 'okx',
      ok: false,
      httpStatus: null,
      latencyMs: null,
      apiCode: null,
      articleCount: 0,
      sampleTitle: null,
      sampleUrl: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @param {'binance'|'bybit'|'okx'|'all'} which
 */
export async function runCexProbe(which = 'all') {
  const wanted = String(which || 'all').toLowerCase();
  /** @type {Promise<ReturnType<typeof probeBinance>>[]} */
  const jobs = [];
  const labels = [];
  if (wanted === 'all' || wanted === 'binance') {
    jobs.push(probeBinance());
    labels.push('binance');
  }
  if (wanted === 'all' || wanted === 'bybit') {
    jobs.push(probeBybit());
    labels.push('bybit');
  }
  if (wanted === 'all' || wanted === 'okx') {
    jobs.push(probeOkx());
    labels.push('okx');
  }
  if (jobs.length === 0) {
    throw new Error('exchange must be binance, bybit, okx, or all');
  }
  const settled = await Promise.all(jobs);
  /** @type {Record<string, unknown>} */
  const results = {};
  settled.forEach((r, i) => {
    results[labels[i]] = r;
  });
  const allOk = settled.every((r) => r.ok);
  return { allOk, results };
}

function clip(text, max = 200) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
