/**
 * Cloudflare Workers entry — mirrors Vercel `/api/settings` + `/api/event-analyze`.
 * Does not scrape Binance/Bybit; Flutter still fetches exchange data on-device.
 */
import defaultSettings from '../settings.json';

const GEMINI_MODEL = 'gemini-3.5-flash-lite';

const LANGUAGE_NAMES = {
  en: 'English',
  ko: 'Korean',
  zh: 'Simplified Chinese',
  ja: 'Japanese',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/api/settings' || path === '/settings') {
        return handleSettings(request, env);
      }
      if (path === '/api/event-analyze' || path === '/event-analyze') {
        return handleEventAnalyze(request, env);
      }
      if (path === '/privacy') {
        return privacyHtml();
      }
      if (path === '/' || path === '/health') {
        return json({ ok: true, runtime: 'cloudflare-workers' });
      }
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('[worker]', error);
      return json(
        { error: error instanceof Error ? error.message : String(error) },
        500,
      );
    }
  },
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...CORS,
      ...extraHeaders,
    },
  });
}

function privacyHtml() {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Privacy Policy - Exora</title>
<style>body{max-width:720px;margin:0 auto;padding:32px 20px 64px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans KR",sans-serif;line-height:1.65;color:#1a1a1a}h1{font-size:1.75rem}a{color:#1a4d6d}</style>
</head><body>
<h1>Privacy Policy</h1>
<p>Exora (Exora - Crypto Exchange Hub). Full policy:
<a href="https://cryptoexchangeinfoserver.vercel.app/privacy">cryptoexchangeinfoserver.vercel.app/privacy</a></p>
<p>Contact: <a href="mailto:gunnylove@gmail.com">gunnylove@gmail.com</a></p>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...CORS },
  });
}

function envOr(env, key, fallback) {
  const value = String(env?.[key] ?? '').trim();
  return value.length > 0 ? value : fallback;
}

function handleSettings(request, env) {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, OPTIONS' });
  }

  const settings = structuredClone(defaultSettings);
  settings.ref = settings.ref ?? { ios: {}, android: {} };
  settings.ref.ios = {
    ...settings.ref.ios,
    initial_ad: envOr(env, 'IOS_INITIAL_AD', settings.ref.ios.initial_ad),
    rewarded_ad: envOr(env, 'IOS_REWARDED_AD', settings.ref.ios.rewarded_ad),
  };
  settings.ref.android = {
    ...settings.ref.android,
    initial_ad: envOr(env, 'ANDROID_INITIAL_AD', settings.ref.android.initial_ad),
    rewarded_ad: envOr(
      env,
      'ANDROID_REWARDED_AD',
      settings.ref.android.rewarded_ad,
    ),
  };
  settings.down_load_url = envOr(
    env,
    'DOWNLOAD_URL',
    settings.down_load_url,
  );
  return json(settings);
}

function normalizeLanguage(raw) {
  const code = String(raw ?? 'en')
    .toLowerCase()
    .split(/[_-]/)[0];
  return LANGUAGE_NAMES[code] ? code : 'en';
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJsonObject(text) {
  try {
    const decoded = JSON.parse(text);
    if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
      return decoded;
    }
  } catch {
    // fall through
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const decoded = JSON.parse(text.slice(start, end + 1));
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
        return decoded;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function clip(text, max = 2000) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function buildSystemPrompt(language) {
  const langName = LANGUAGE_NAMES[language] ?? 'English';
  return `You explain crypto exchange events and announcements simply for beginners.
Do not give investment advice. Do not invent rewards or conditions that are not in the source. If unsure, say so.
Write EVERY string value in ${langName} only (language code: ${language}).
Return a JSON object only:
{
  "summary": "2-4 sentence summary in ${langName}",
  "reward": "reward summary in ${langName} (empty string if unknown)",
  "period": "period summary in ${langName} (empty string if unknown)",
  "conditions": ["participation requirement bullets in ${langName}"],
  "cautions": ["cautions / region / KYC / risk bullets in ${langName}"]
}`;
}

function requireAppToken(request, env) {
  const expected = String(env.EXORA_API_TOKEN ?? '').trim();
  if (!expected) {
    return { ok: false, response: json({ error: 'EXORA_API_TOKEN is not configured' }, 503) };
  }
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const provided = match?.[1]?.trim() ?? '';
  if (!provided || provided !== expected) {
    return { ok: false, response: json({ error: 'Unauthorized' }, 401) };
  }
  return { ok: true };
}

async function handleEventAnalyze(request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST, OPTIONS' });
  }

  const auth = requireAppToken(request, env);
  if (!auth.ok) return auth.response;

  const apiKey = String(env.GEMINI_API_KEY ?? '').trim();
  if (!apiKey) {
    return json({ error: 'GEMINI_API_KEY is not configured' }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  if (!payload || typeof payload !== 'object') {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const language = normalizeLanguage(
    payload.language ?? payload.locale ?? payload.lang,
  );
  const title = asText(payload.title);
  const description = asText(payload.description);
  const exchange =
    typeof payload.exchange === 'string' ? payload.exchange.trim() : '';
  const url = typeof payload.url === 'string' ? payload.url.trim() : '';
  const tags = Array.isArray(payload.tags)
    ? payload.tags.map((t) => String(t)).filter(Boolean)
    : [];

  if (!title) {
    return json({ error: 'title is required' }, 400);
  }

  const userPrompt = `Respond in ${LANGUAGE_NAMES[language]} (language=${language}).
Exchange: ${exchange}
Title: ${title}
Tags: ${tags.join(', ')}
Description: ${description || '(none)'}
Source URL: ${url}
Start (ms): ${payload.startDateTimestamp ?? null}
End (ms): ${payload.endDateTimestamp ?? null}`;

  const endpoint = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
  );
  endpoint.searchParams.set('key', apiKey);

  try {
    const geminiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildSystemPrompt(language) }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(55_000),
    });

    const rawText = await geminiRes.text();
    if (!geminiRes.ok) {
      console.error('[event-analyze] Gemini HTTP', geminiRes.status, rawText);
      return json(
        {
          error: `Gemini HTTP ${geminiRes.status}`,
          detail: clip(rawText),
          model: GEMINI_MODEL,
        },
        500,
      );
    }

    let body;
    try {
      body = JSON.parse(rawText);
    } catch {
      return json(
        { error: 'Invalid Gemini response', detail: clip(rawText) },
        500,
      );
    }

    const candidates = body.candidates ?? [];
    if (!candidates.length) {
      return json(
        { error: 'Empty Gemini candidates', detail: clip(rawText) },
        500,
      );
    }

    const parts = candidates[0]?.content?.parts ?? [];
    const text = parts
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim();

    if (!text) {
      return json({ error: 'Empty Gemini text', detail: clip(rawText) }, 500);
    }

    const analysis = parseJsonObject(text);
    if (!analysis) {
      return json(
        { error: 'Failed to parse Gemini JSON', detail: clip(text) },
        500,
      );
    }

    return json({ analysis });
  } catch (error) {
    console.error('[event-analyze]', error);
    return json(
      {
        error: error instanceof Error ? error.message : String(error),
        detail:
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
      },
      500,
    );
  }
}
