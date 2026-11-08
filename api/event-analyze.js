import { requireAppToken } from '../lib/auth.js';
import { applyCors, handleOptions } from '../lib/cors.js';
import { fetchAnnouncementText } from '../lib/fetch-announcement-text.js';

const LANGUAGE_NAMES = {
  en: 'English',
  ko: 'Korean',
  zh: 'Simplified Chinese',
  ja: 'Japanese',
};

function normalizeLanguage(raw) {
  const code = String(raw ?? 'en')
    .toLowerCase()
    .split(/[_-]/)[0];
  if (LANGUAGE_NAMES[code]) return code;
  return 'en';
}

function buildSystemPrompt(language) {
  const langName = LANGUAGE_NAMES[language] ?? 'English';
  return `You explain crypto exchange events and announcements simply for beginners.

Goals:
- The "summary" field is the main "easy explanation" the user reads first. Make it self-contained and useful.
- Use the Source URL page text (when provided) together with title/description/tags. Prefer the page text for concrete details (what it is, who can join, what you get, how to join, deadlines).
- Summarize those details in plain language so the user understands without opening the announcement first.

Hard rules:
- Do NOT give investment advice.
- Do NOT invent rewards, amounts, dates, or conditions that are not supported by the provided materials.
- Do NOT tell the user to "check / read / refer to the official announcement" as a substitute for explaining. Put the explanation in "summary" (and the other fields). You may still note that details can change on the exchange.
- If the page text is missing or thin, use title + description + tags, and clearly say what is unknown instead of deferring to the URL.
- If unsure, say what is unclear in one short clause — still give the best plain-language explanation you can from available facts.
- Write EVERY string value in ${langName} only (language code: ${language}).

Return a JSON object only:
{
  "summary": "3-6 sentence easy explanation in ${langName}: what this is, why it matters, key reward/period/how-to highlights from the source",
  "reward": "reward summary in ${langName} (empty string if unknown)",
  "period": "period / deadline summary in ${langName} (empty string if unknown)",
  "conditions": ["participation / eligibility requirement bullets in ${langName}"],
  "cautions": ["cautions / region / KYC / risk bullets in ${langName}"]
}`;
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

/**
 * POST /api/event-analyze
 * Body: { exchange, title, description, tags, url,
 *         startDateTimestamp, endDateTimestamp, language }
 * Env: GEMINI_API_KEY (required)
 */
const GEMINI_MODEL = 'gemini-3.5-flash-lite';

export default async function handler(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requireAppToken(req, res)) return;

  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? '';
  if (!apiKey) {
    return res.status(503).json({ error: 'GEMINI_API_KEY is not configured' });
  }

  let payload = null;
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    payload = req.body;
  } else if (typeof req.body === 'string') {
    try {
      payload = JSON.parse(req.body);
    } catch {
      payload = null;
    }
  }
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'invalid JSON body' });
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
    return res.status(400).json({ error: 'title is required' });
  }

  const pageText = url ? await fetchAnnouncementText(url) : '';

  const userPrompt = `Respond in ${LANGUAGE_NAMES[language]} (language=${language}).
Write a self-contained easy explanation in "summary" using the materials below (especially Source page text when present). Do not tell the reader to go read the announcement instead of explaining.

Exchange: ${exchange}
Title: ${title}
Tags: ${tags.join(', ')}
Description: ${description || '(none)'}
Source URL: ${url || '(none)'}
Source page text: ${pageText || '(unavailable — explain from title/description/tags only; state unknowns briefly)'}
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
      return res.status(500).json({
        error: `Gemini HTTP ${geminiRes.status}`,
        detail: clip(rawText),
        model: GEMINI_MODEL,
      });
    }

    let body;
    try {
      body = JSON.parse(rawText);
    } catch (parseError) {
      console.error('[event-analyze] Invalid Gemini response', rawText);
      return res.status(500).json({
        error: 'Invalid Gemini response',
        detail: clip(rawText),
      });
    }

    const candidates = body.candidates ?? [];
    if (!candidates.length) {
      console.error('[event-analyze] Empty Gemini candidates', rawText);
      return res.status(500).json({
        error: 'Empty Gemini candidates',
        detail: clip(rawText),
      });
    }

    const parts = candidates[0]?.content?.parts ?? [];
    const text = parts
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim();

    if (!text) {
      console.error('[event-analyze] Empty Gemini text', rawText);
      return res.status(500).json({
        error: 'Empty Gemini text',
        detail: clip(rawText),
      });
    }

    const analysis = parseJsonObject(text);
    if (!analysis) {
      console.error('[event-analyze] Failed to parse Gemini JSON', text);
      return res.status(500).json({
        error: 'Failed to parse Gemini JSON',
        detail: clip(text),
      });
    }

    return res.status(200).json({ analysis });
  } catch (error) {
    console.error('[event-analyze]', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
      detail: error instanceof Error ? error.stack ?? error.message : String(error),
    });
  }
}

function clip(text, max = 2000) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
