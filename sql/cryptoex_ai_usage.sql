-- AI analyze usage / estimated Gemini cost (applied via Supabase)
create table if not exists public.cryptoex_ai_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  model text not null,
  exchange text,
  language text,
  ok boolean not null default true,
  prompt_tokens integer not null default 0,
  candidates_tokens integer not null default 0,
  total_tokens integer not null default 0,
  thoughts_tokens integer not null default 0,
  tool_use_prompt_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 8) not null default 0,
  url_context_ok boolean,
  error text
);

create index if not exists cryptoex_ai_usage_created_at_idx
  on public.cryptoex_ai_usage (created_at desc);

alter table public.cryptoex_ai_usage enable row level security;
