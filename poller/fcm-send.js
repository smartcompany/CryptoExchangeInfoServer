import { GoogleAuth } from 'google-auth-library';
import { CAT_LABEL, fcmCondition } from './topics.js';

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

/**
 * Send one opportunity push via FCM topic condition.
 * No-op (returns { skipped: true }) when credentials missing.
 */
export async function sendOpportunityPush(event) {
  const sa = loadServiceAccount();
  if (!sa?.project_id) {
    return { skipped: true, reason: 'no_credentials' };
  }

  const condition = fcmCondition(event.category, event.exchange);
  if (!condition) {
    return { skipped: true, reason: 'unknown_exchange' };
  }

  const exchangeLabel =
    String(event.exchange || '').charAt(0).toUpperCase() +
    String(event.exchange || '').slice(1);
  const catLabel = CAT_LABEL[event.category] || CAT_LABEL.other;
  const title = `${exchangeLabel} · ${catLabel}`;
  const body = String(event.title || '').slice(0, 120);

  const accessToken = await getAccessToken(sa);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

  const message = {
    message: {
      condition,
      notification: { title, body },
      data: {
        url: String(event.url || ''),
        exchange: String(event.exchange || ''),
        category: String(event.category || 'other'),
        eventId: String(event.id || ''),
      },
      android: {
        priority: 'high',
      },
      apns: {
        payload: {
          aps: { sound: 'default' },
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
  return { ok: true, name: parsed.name, condition };
}
