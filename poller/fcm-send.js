import { GoogleAuth } from 'google-auth-library';
import { fcmDigestCondition } from './topics.js';

const SCOPES = ['https://www.googleapis.com/auth/firebase.messaging'];

function loadServiceAccount() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
}

let cachedAuth = null;

async function getAccessToken(sa) {
  if (!cachedAuth) {
    cachedAuth = new GoogleAuth({
      credentials: sa,
      scopes: SCOPES,
    });
  }
  const client = await cachedAuth.getClient();
  const token = await client.getAccessToken();
  if (!token?.token) throw new Error('Failed to obtain FCM access token');
  return token.token;
}

function uniquePreserve(values) {
  const out = [];
  const seen = new Set();
  for (const v of values) {
    const key = String(v || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * One data-only digest per poll tick.
 * Client localizes + shows a local notification; filters by local prefs.
 */
export async function sendOpportunityDigest(events) {
  const sa = loadServiceAccount();
  if (!sa?.project_id) {
    return { skipped: true, reason: 'no_credentials' };
  }

  const list = Array.isArray(events) ? events.filter(Boolean) : [];
  if (list.length === 0) {
    return { skipped: true, reason: 'empty' };
  }

  const exchanges = uniquePreserve(list.map((e) => e.exchange));
  const categories = uniquePreserve(list.map((e) => e.category || 'other'));
  const condition = fcmDigestCondition(exchanges);
  if (!condition) {
    return { skipped: true, reason: 'unknown_exchange' };
  }

  // pairs: "binance:contest,okx:listing" — client filters by prefs.
  const pairs = uniquePreserve(
    list.map((e) => `${e.exchange}:${e.category || 'other'}`),
  );
  const firstUrl = String(list.find((e) => e.url)?.url || '');

  const accessToken = await getAccessToken(sa);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

  const message = {
    message: {
      condition,
      // Data-only: OS must not show a pre-localized banner.
      data: {
        type: 'opportunity_digest',
        exchanges: exchanges.join(','),
        categories: categories.join(','),
        pairs: pairs.join(','),
        count: String(list.length),
        url: firstUrl,
      },
      android: {
        priority: 'high',
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'background',
        },
        payload: {
          aps: {
            'content-available': 1,
          },
        },
      },
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: parsed,
      condition,
    };
  }
  return {
    ok: true,
    name: parsed.name,
    condition,
    exchanges,
    categories,
    count: list.length,
  };
}
