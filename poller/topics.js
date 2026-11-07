/** Must match client/lib/services/push_topics.dart */

export const CAT = {
  contest: 'exora_cat_contest',
  earn: 'exora_cat_earn',
  listing: 'exora_cat_listing',
  deposit: 'exora_cat_deposit',
  other: 'exora_cat_other',
};

export const EX = {
  binance: 'exora_ex_binance',
  bybit: 'exora_ex_bybit',
  okx: 'exora_ex_okx',
};

export const CAT_LABEL = {
  contest: 'Trading contest',
  earn: 'Earn boost',
  listing: 'New listing',
  deposit: 'Deposit bonus',
  other: 'Campaign',
};

/** Single-item condition (legacy). Prefer [fcmDigestCondition]. */
export function fcmCondition(category, exchange) {
  const catTopic = CAT[category] || CAT.other;
  const exTopic = EX[exchange];
  if (!exTopic) return null;
  return `'${catTopic}' in topics && '${exTopic}' in topics`;
}

/**
 * Digest targeting: OR of exchange topics present in the batch.
 * FCM allows ≤5 topics in a condition; we poll ≤3 exchanges.
 * Client filters by category prefs before showing.
 */
export function fcmDigestCondition(exchanges) {
  const topics = [];
  const seen = new Set();
  for (const ex of exchanges) {
    const t = EX[ex];
    if (!t || seen.has(t)) continue;
    seen.add(t);
    topics.push(t);
  }
  if (topics.length === 0) return null;
  if (topics.length === 1) return `'${topics[0]}' in topics`;
  return topics.map((t) => `'${t}' in topics`).join(' || ');
}
