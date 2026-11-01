import { applyCors, handleOptions } from '../lib/cors.js';
import defaultSettings from '../settings.json' with { type: 'json' };

function envOr(key, fallback) {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : fallback;
}

/**
 * GET /api/settings
 * flutter_share_lib AdService 설정. 유닛 ID는 env로 덮어쓸 수 있음.
 */
export default function handler(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const settings = structuredClone(defaultSettings);
    settings.ref = settings.ref ?? { ios: {}, android: {} };
    settings.ref.ios = {
      ...settings.ref.ios,
      initial_ad: envOr('IOS_INITIAL_AD', settings.ref.ios.initial_ad),
      rewarded_ad: envOr('IOS_REWARDED_AD', settings.ref.ios.rewarded_ad),
    };
    settings.ref.android = {
      ...settings.ref.android,
      initial_ad: envOr('ANDROID_INITIAL_AD', settings.ref.android.initial_ad),
      rewarded_ad: envOr('ANDROID_REWARDED_AD', settings.ref.android.rewarded_ad),
    };
    settings.down_load_url = envOr('DOWNLOAD_URL', settings.down_load_url);

    return res.status(200).json(settings);
  } catch (error) {
    console.error('[settings]', error);
    return res.status(500).json({ error: 'Failed to load settings' });
  }
}
