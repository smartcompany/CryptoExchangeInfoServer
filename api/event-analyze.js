import { requireAppToken } from '../lib/auth.js';
import { applyCors, handleOptions } from '../lib/cors.js';
import { parseGeminiUsage, recordAiUsage } from '../lib/ai-usage.js';

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
  return `You explain crypto exchange events and announcements for beginners in a scannable, detailed way.

Primary task:
- ALWAYS use the URL context tool to open and read the Source URL announcement page first (full article body, not just the title).
- From that page, write a detailed "summary" so the user understands without opening the link.
- Also fill reward / period / conditions / cautions from the same page.

Readability rules for ALL string fields (especially "summary"):
- Use Markdown the UI can render: blank lines between short paragraphs; **bold** for key facts (dates, %, amounts, tiers, exchange names, deadlines).
- Prefer short paragraphs (1–2 sentences) over one long block. Use line breaks so it is easy to scan on a phone.
- You may start a paragraph or bullet with ONE relevant emoji for scanning (examples: 📌 overview, 🎁 reward, 📅 period, ✅ how to join, ⚠️ caution). Do not spam emojis; at most one leading emoji per paragraph/bullet.
- In "summary", cover: what it is → who/eligibility → rewards → how to join → period/deadlines → key cautions. Keep concrete numbers from the page.
- "reward" / "period" may also use **bold** and a leading emoji.
- "conditions" / "cautions": short bullets; bold the critical clause when helpful.

Hard rules:
- Do NOT give investment advice.
- Do NOT invent rewards, amounts, dates, or conditions. Only use what appears on the retrieved page (plus the provided title/description/tags as secondary hints).
- Do NOT tell the user to "check / read / refer to the official announcement" instead of explaining. Put the details in the JSON fields. A short note that terms can change is OK.
- If URL retrieval fails or the body is unreadable, say what is unknown briefly and fall back to title + description + tags only — still do not invent facts.
- Write EVERY string value in ${langName} only (language code: ${language}). JSON keys stay in English. Escape newlines in JSON strings properly.

Return a JSON object only:
{
  "summary": "Markdown multi-paragraph detailed explanation in ${langName}",
  "reward": "reward / benefit summary in ${langName} (empty string if unknown)",
  "period": "period / deadline summary in ${langName} (empty string if unknown)",
  "conditions": ["participation / eligibility bullets in ${langName}"],
  "cautions": ["caution bullets in ${langName}"]
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
 * Gemini reads the announcement via URL context tool.
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

  const userPrompt = `Respond in ${LANGUAGE_NAMES[language]} (language=${language}).
Use the URL context tool to read the Source URL announcement body, then write a detailed explanation in "summary" (and the other fields).
Format for phone readability: short paragraphs, blank lines, **bold** key facts, optional single leading emoji per paragraph/bullet.
Do not tell the reader to go read the announcement instead of explaining.
Title/description/tags are hints only — prefer facts from the retrieved page.

Exchange: ${exchange}
Title: ${title}
Tags: ${tags.join(', ')}
Description: ${description || '(none)'}
Source URL: ${url || '(none — no page to retrieve; use title/description/tags only)'}
Start (ms): ${payload.startDateTimestamp ?? null}
End (ms): ${payload.endDateTimestamp ?? null}`;

  const endpoint = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
  );
  endpoint.searchParams.set('key', apiKey);

  const requestBody = {
    systemInstruction: {
      parts: [{ text: buildSystemPrompt(language) }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    // Gemini retrieves the announcement body from Source URL.
    tools: url ? [{ url_context: {} }] : undefined,
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
    },
  };
  if (!requestBody.tools) delete requestBody.tools;

  try {
    const geminiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(55_000),
    });

    const rawText = await geminiRes.text();
    if (!geminiRes.ok) {
      console.error('[event-analyze] Gemini HTTP', geminiRes.status, rawText);
      await recordAiUsage({
        model: GEMINI_MODEL,
        exchange,
        language,
        ok: false,
        error: `Gemini HTTP ${geminiRes.status}`,
      });
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
      await recordAiUsage({
        model: GEMINI_MODEL,
        exchange,
        language,
        ok: false,
        error: 'Invalid Gemini response',
      });
      return res.status(500).json({
        error: 'Invalid Gemini response',
        detail: clip(rawText),
      });
    }

    const usage = parseGeminiUsage(
      body.usageMetadata ?? body.usage_metadata ?? null,
    );

    const candidates = body.candidates ?? [];
    if (!candidates.length) {
      console.error('[event-analyze] Empty Gemini candidates', rawText);
      await recordAiUsage({
        model: GEMINI_MODEL,
        exchange,
        language,
        ok: false,
        error: 'Empty Gemini candidates',
        ...usage,
      });
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
      await recordAiUsage({
        model: GEMINI_MODEL,
        exchange,
        language,
        ok: false,
        error: 'Empty Gemini text',
        ...usage,
      });
      return res.status(500).json({
        error: 'Empty Gemini text',
        detail: clip(rawText),
      });
    }

    const analysis = parseJsonObject(text);
    if (!analysis) {
      console.error('[event-analyze] Failed to parse Gemini JSON', text);
      await recordAiUsage({
        model: GEMINI_MODEL,
        exchange,
        language,
        ok: false,
        error: 'Failed to parse Gemini JSON',
        ...usage,
      });
      return res.status(500).json({
        error: 'Failed to parse Gemini JSON',
        detail: clip(text),
      });
    }

    const urlContextMeta =
      candidates[0]?.urlContextMetadata ??
      candidates[0]?.url_context_metadata ??
      body.urlContextMetadata ??
      body.url_context_metadata ??
      null;
    if (urlContextMeta) {
      console.log(
        '[event-analyze] url_context_metadata',
        JSON.stringify(urlContextMeta),
      );
    }

    const urlMetaList =
      urlContextMeta?.urlMetadata ?? urlContextMeta?.url_metadata ?? [];
    const urlContextOk = Array.isArray(urlMetaList)
      ? urlMetaList.some((m) =>
          String(
            m?.urlRetrievalStatus ?? m?.url_retrieval_status ?? '',
          ).includes('SUCCESS'),
        )
      : null;

    await recordAiUsage({
      model: GEMINI_MODEL,
      exchange,
      language,
      ok: true,
      urlContextOk,
      ...usage,
    });

    return res.status(200).json({
      analysis,
      usage: {
        promptTokens: usage.promptTokens,
        candidatesTokens: usage.candidatesTokens,
        thoughtsTokens: usage.thoughtsTokens,
        totalTokens: usage.totalTokens,
        estimatedCostUsd: usage.estimatedCostUsd,
      },
      ...(urlContextMeta ? { urlContext: urlContextMeta } : {}),
    });
  } catch (error) {
    console.error('[event-analyze]', error);
    await recordAiUsage({
      model: GEMINI_MODEL,
      exchange,
      language,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
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
