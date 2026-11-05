/**
 * Rule-based category from title/tags (MVP; AI later).
 * @returns {'contest'|'earn'|'listing'|'deposit'|'other'}
 */
export function classifyAnnouncement({ title = '', tags = [] } = {}) {
  const hay = `${title} ${(tags || []).join(' ')}`.toLowerCase();

  const rules = [
    {
      cat: 'contest',
      re: /\b(contest|competition|trading\s*comp|trade\s*to\s*earn|pnl\s*contest|futures\s*contest|spot\s*contest|대회|コンペ|大赛)\b/i,
    },
    {
      cat: 'earn',
      re: /\b(earn|apr|apy|launchpool|simple\s*earn|flexible\s*earn|fixed\s*earn|savings|flash\s*earn|hold\s*to\s*earn|dual\s*investment)\b/i,
    },
    {
      cat: 'listing',
      re: /\b(will\s*list|lists?\b|listing|launchpad|launchpool\s*list|seed\s*tag|신규\s*상장|上場|上线|上幣)\b/i,
    },
    {
      cat: 'deposit',
      re: /\b(deposit\s*bonus|welcome\s*bonus|signup\s*bonus|sign[- ]?up\s*bonus|first\s*deposit|입금\s*보너스|ウェルカム|注册奖励)\b/i,
    },
  ];

  for (const rule of rules) {
    if (rule.re.test(hay)) return rule.cat;
  }
  return 'other';
}
