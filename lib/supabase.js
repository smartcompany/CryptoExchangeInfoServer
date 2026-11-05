import { createClient } from '@supabase/supabase-js';

let cached = null;

/**
 * Service-role client for server-side upserts (bypasses RLS).
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
export function getSupabaseAdmin() {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured',
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
