import { requireAppToken } from '../lib/auth.js';
import { applyCors, handleOptions } from '../lib/cors.js';
import { summarizeAiUsage } from '../lib/ai-usage.js';

/**
 * GET /api/ai-usage?days=30&limit=50
 * Auth: Authorization: Bearer <EXORA_API_TOKEN>
 */
export default async function handler(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requireAppToken(req, res)) return;

  const url = new URL(req.url || '/', 'http://local');
  const days = Math.min(
    Math.max(Number(url.searchParams.get('days') || 30) || 30, 1),
    365,
  );
  const limit = Math.min(
    Math.max(Number(url.searchParams.get('limit') || 50) || 50, 1),
    200,
  );

  try {
    const data = await summarizeAiUsage({ days, limit });
    return res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error('[ai-usage]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
