import { getSupabaseAdmin } from './supabase.js';

/** Default paid-tier rates for gemini-3.5-flash-lite (USD / 1M tokens). */
const DEFAULT_INPUT_PER_M = 0.3;
const DEFAULT_OUTPUT_PER_M = 2.5;

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function geminiRates() {
  return {
    inputPerM: num(process.env.GEMINI_INPUT_USD_PER_1M, DEFAULT_INPUT_PER_M),
    outputPerM: num(process.env.GEMINI_OUTPUT_USD_PER_1M, DEFAULT_OUTPUT_PER_M),
  };
}

/**
 * Parse Gemini `usageMetadata` (camel or snake) into token counts + estimate.
 */
export function parseGeminiUsage(usageMetadata) {
  const u = usageMetadata && typeof usageMetadata === 'object' ? usageMetadata : {};
  const promptTokens = num(u.promptTokenCount ?? u.prompt_token_count);
  const candidatesTokens = num(
    u.candidatesTokenCount ?? u.candidates_token_count,
  );
  const totalTokens = num(u.totalTokenCount ?? u.total_token_count);
  const thoughtsTokens = num(u.thoughtsTokenCount ?? u.thoughts_token_count);
  const toolUsePromptTokens = num(
    u.toolUsePromptTokenCount ?? u.tool_use_prompt_token_count,
  );

  // Output billed tokens ≈ candidates + thoughts (Google: output includes thinking).
  const outputTokens = candidatesTokens + thoughtsTokens;
  const inputTokens = promptTokens;

  const { inputPerM, outputPerM } = geminiRates();
  const estimatedCostUsd =
    (inputTokens / 1_000_000) * inputPerM +
    (outputTokens / 1_000_000) * outputPerM;

  return {
    promptTokens,
    candidatesTokens,
    totalTokens: totalTokens || inputTokens + outputTokens,
    thoughtsTokens,
    toolUsePromptTokens,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    rates: { inputPerM, outputPerM },
  };
}

export async function recordAiUsage(row) {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('cryptoex_ai_usage').insert({
      model: row.model || '',
      exchange: row.exchange || null,
      language: row.language || null,
      ok: row.ok !== false,
      prompt_tokens: row.promptTokens ?? 0,
      candidates_tokens: row.candidatesTokens ?? 0,
      total_tokens: row.totalTokens ?? 0,
      thoughts_tokens: row.thoughtsTokens ?? 0,
      tool_use_prompt_tokens: row.toolUsePromptTokens ?? 0,
      estimated_cost_usd: row.estimatedCostUsd ?? 0,
      url_context_ok: row.urlContextOk ?? null,
      error: row.error || null,
    });
    if (error) {
      console.error('[ai-usage] insert failed', error.message);
    }
  } catch (err) {
    console.error('[ai-usage] record failed', err);
  }
}

export async function summarizeAiUsage({ days = 30, limit = 50 } = {}) {
  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('cryptoex_ai_usage')
    .select(
      'id, created_at, model, exchange, language, ok, prompt_tokens, candidates_tokens, total_tokens, thoughts_tokens, tool_use_prompt_tokens, estimated_cost_usd, url_context_ok, error',
    )
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));

  if (error) throw error;

  const rows = data || [];
  const { count: totalCount, error: countError } = await supabase
    .from('cryptoex_ai_usage')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since);
  if (countError) throw countError;

  // Aggregate via a wider fetch for sums (cap 5000 for dashboard).
  const { data: all, error: allError } = await supabase
    .from('cryptoex_ai_usage')
    .select(
      'ok, prompt_tokens, candidates_tokens, total_tokens, thoughts_tokens, estimated_cost_usd, created_at, exchange',
    )
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (allError) throw allError;

  const list = all || [];
  let calls = list.length;
  let okCalls = 0;
  let failCalls = 0;
  let promptSum = 0;
  let candidatesSum = 0;
  let thoughtsSum = 0;
  let totalTokSum = 0;
  let costSum = 0;
  const byDay = {};
  const byExchange = {};

  for (const r of list) {
    if (r.ok) okCalls += 1;
    else failCalls += 1;
    promptSum += num(r.prompt_tokens);
    candidatesSum += num(r.candidates_tokens);
    thoughtsSum += num(r.thoughts_tokens);
    totalTokSum += num(r.total_tokens);
    costSum += num(r.estimated_cost_usd);
    const day = String(r.created_at || '').slice(0, 10) || 'unknown';
    if (!byDay[day]) byDay[day] = { calls: 0, costUsd: 0 };
    byDay[day].calls += 1;
    byDay[day].costUsd += num(r.estimated_cost_usd);
    const ex = r.exchange || 'unknown';
    if (!byExchange[ex]) byExchange[ex] = { calls: 0, costUsd: 0 };
    byExchange[ex].calls += 1;
    byExchange[ex].costUsd += num(r.estimated_cost_usd);
  }

  const avgCost = calls > 0 ? costSum / calls : 0;
  const rates = geminiRates();

  return {
    days,
    since,
    rates,
    truncated: (totalCount ?? calls) > list.length,
    totalInRange: totalCount ?? calls,
    summary: {
      calls,
      okCalls,
      failCalls,
      promptTokens: promptSum,
      candidatesTokens: candidatesSum,
      thoughtsTokens: thoughtsSum,
      totalTokens: totalTokSum,
      estimatedCostUsd: costSum,
      avgCostUsdPerCall: avgCost,
    },
    byDay: Object.entries(byDay)
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([day, v]) => ({ day, ...v, costUsd: round8(v.costUsd) })),
    byExchange: Object.entries(byExchange)
      .sort((a, b) => b[1].calls - a[1].calls)
      .map(([exchange, v]) => ({
        exchange,
        ...v,
        costUsd: round8(v.costUsd),
      })),
    recent: rows.map((r) => ({
      ...r,
      estimated_cost_usd: num(r.estimated_cost_usd),
    })),
  };
}

function round8(n) {
  return Math.round(num(n) * 1e8) / 1e8;
}
