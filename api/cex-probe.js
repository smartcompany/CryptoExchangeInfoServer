import { requireAppToken } from '../lib/auth.js';
import { applyCors, handleOptions } from '../lib/cors.js';
import { runCexProbe } from '../lib/cex-fetch.js';

/**
 * GET /api/cex-probe?exchange=all|binance|bybit|okx
 * Auth: Authorization: Bearer <EXORA_API_TOKEN>
 *
 * Hits CEX public announcement APIs from this host so you can see if
 * the host is geo-blocked before enabling a push poller.
 */
export default async function handler(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requireAppToken(req, res)) return;

  const url = new URL(req.url || '/', 'http://localhost');
  const exchange = url.searchParams.get('exchange') || 'all';

  try {
    const { allOk, results, egress } = await runCexProbe(exchange);
    return res.status(200).json({
      ok: allOk,
      runtime: process.env.VERCEL ? 'vercel' : 'node',
      egress,
      probedAt: new Date().toISOString(),
      exchange,
      results,
    });
  } catch (error) {
    console.error('[cex-probe]', error);
    return res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
