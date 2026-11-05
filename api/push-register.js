import { requireAppToken } from '../lib/auth.js';
import { applyCors, handleOptions } from '../lib/cors.js';
import { getSupabaseAdmin } from '../lib/supabase.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/push-register
 * Auth: Authorization: Bearer <EXORA_API_TOKEN>
 *
 * Body: { id, push_token?, platform?, locale?, push_enabled? }
 * Upserts into public.cryptoex_users on id.
 */
export default async function handler(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requireAppToken(req, res)) return;

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: 'id must be a UUID' });
  }

  const pushEnabled = Boolean(body.push_enabled);
  let pushToken =
    typeof body.push_token === 'string' ? body.push_token.trim() : null;
  if (!pushToken) pushToken = null;

  let platform = typeof body.platform === 'string' ? body.platform.trim() : '';
  if (!['ios', 'android', 'unknown'].includes(platform)) {
    platform = 'unknown';
  }

  const locale =
    typeof body.locale === 'string' && body.locale.trim()
      ? body.locale.trim().slice(0, 16)
      : null;

  // When disabled, clear token so stale FCM tokens are not targeted later.
  if (!pushEnabled) {
    pushToken = null;
  }

  const row = {
    id,
    push_token: pushToken,
    platform,
    locale,
    push_enabled: pushEnabled,
    last_seen_at: new Date().toISOString(),
  };

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('cryptoex_users')
      .upsert(row, { onConflict: 'id' })
      .select('id, push_enabled, platform, locale, updated_at, last_seen_at')
      .single();

    if (error) {
      console.error('[push-register] supabase', error);
      return res.status(500).json({
        error: 'Failed to upsert user',
        detail: error.message,
      });
    }

    console.log(
      `[push-register] upserted id=${id} enabled=${pushEnabled} platform=${platform} hasToken=${Boolean(pushToken)}`,
    );
    return res.status(200).json({ ok: true, user: data });
  } catch (err) {
    console.error('[push-register]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
