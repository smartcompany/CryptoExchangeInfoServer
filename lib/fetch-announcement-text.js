/**
 * Best-effort plain-text extract from an announcement URL for AI context.
 * Returns '' on failure (caller still has title/description).
 */

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
};

const MAX_CHARS = 8_000;

function stripHtml(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchAnnouncementText(url, { timeoutMs = 12_000 } = {}) {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed) return '';
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';

  try {
    const res = await fetch(trimmed, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return '';
    const contentType = res.headers.get('content-type') || '';
    const raw = await res.text();
    let text = raw;
    if (contentType.includes('html') || /<html[\s>]/i.test(raw)) {
      text = stripHtml(raw);
    } else if (contentType.includes('json')) {
      try {
        text = JSON.stringify(JSON.parse(raw));
      } catch {
        text = raw;
      }
    }
    if (text.length <= MAX_CHARS) return text;
    return `${text.slice(0, MAX_CHARS)}…`;
  } catch (err) {
    console.warn(
      '[fetch-announcement-text]',
      trimmed,
      err instanceof Error ? err.message : err,
    );
    return '';
  }
}
