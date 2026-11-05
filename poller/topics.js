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

export function fcmCondition(category, exchange) {
  const catTopic = CAT[category] || CAT.other;
  const exTopic = EX[exchange];
  if (!exTopic) return null;
  // FCM topic condition: both category and exchange must be subscribed.
  return `'${catTopic}' in topics && '${exTopic}' in topics`;
}
