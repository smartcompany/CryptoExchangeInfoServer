import { applyCors, handleOptions } from '../lib/cors.js';

const SYSTEM_PROMPT = `당신은 암호화폐 거래소 이벤트·공지를 초보 투자자에게 쉽게 풀어 설명하는 도우미입니다.
투자 권유를 하지 마세요. 원문에 없는 보상·조건을 지어내지 마세요. 불확실하면 그렇다고 적으세요.
반드시 JSON 객체만 반환하세요:
{
  "summary": "2~4문장 한국어 요약",
  "reward": "보상 요약 (없으면 빈 문자열)",
  "period": "기간 요약 (없으면 빈 문자열)",
  "conditions": ["참여 조건 불릿"],
  "cautions": ["주의점·지역/KYC/위험 불릿"]
}`;

function pickText(ko, en) {
  const a = typeof ko === 'string' ? ko.trim() : '';
  if (a) return a;
  return typeof en === 'string' ? en.trim() : '';
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
 * Body: { exchange, title, titleKo, description, descriptionKo, tags, url, startDateTimestamp, endDateTimestamp }
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

  const title = pickText(payload.titleKo, payload.title);
  const description = pickText(payload.descriptionKo, payload.description);
  const exchange =
    typeof payload.exchange === 'string' ? payload.exchange.trim() : '';
  const url = typeof payload.url === 'string' ? payload.url.trim() : '';
  const tags = Array.isArray(payload.tags)
    ? payload.tags.map((t) => String(t)).filter(Boolean)
    : [];

  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }

  const userPrompt = `거래소: ${exchange}
제목: ${title}
태그: ${tags.join(', ')}
설명: ${description || '(없음)'}
원문 URL: ${url}
시작(ms): ${payload.startDateTimestamp ?? null}
종료(ms): ${payload.endDateTimestamp ?? null}`;

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
          parts: [{ text: SYSTEM_PROMPT }],
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
