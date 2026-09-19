create extension if not exists pgcrypto with schema extensions;

create table public.entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null check (plan in ('free', 'beta', 'paid', 'admin')),
  source text not null check (source in ('google', 'access_code', 'admin')),
  status text not null default 'active' check (status in ('active', 'suspended', 'expired')),
  monthly_input_limit integer not null check (monthly_input_limit >= 0),
  requests_per_minute integer not null default 60 check (requests_per_minute between 1 and 600),
  max_inputs_per_request integer not null default 32 check (max_inputs_per_request between 1 and 128),
  max_characters_per_request integer not null default 120000 check (max_characters_per_request between 1000 and 1000000),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.access_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash bytea not null unique,
  label text not null default 'Gretel access',
  plan text not null default 'beta' check (plan in ('beta', 'paid', 'admin')),
  monthly_input_limit integer not null default 25000 check (monthly_input_limit >= 0),
  requests_per_minute integer not null default 60 check (requests_per_minute between 1 and 600),
  max_inputs_per_request integer not null default 32 check (max_inputs_per_request between 1 and 128),
  max_characters_per_request integer not null default 120000 check (max_characters_per_request between 1000 and 1000000),
  max_redemptions integer not null default 1 check (max_redemptions >= 1),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  expires_at timestamptz,
  entitlement_expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.access_code_redemptions (
  id bigint generated always as identity primary key,
  code_id uuid not null references public.access_codes(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (code_id, user_id)
);

create table public.embedding_usage_periods (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  input_count integer not null default 0 check (input_count >= 0),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, period_start)
);

create table public.embedding_rate_buckets (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, bucket_start)
);

create table public.embedding_usage (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  model text not null,
  requested_inputs integer not null check (requested_inputs >= 0),
  cached_inputs integer not null check (cached_inputs >= 0),
  billed_inputs integer not null check (billed_inputs >= 0),
  character_count integer not null check (character_count >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'succeeded', 'failed')),
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index embedding_usage_user_created_idx
  on public.embedding_usage (user_id, created_at desc);

create table public.embedding_cache (
  model text not null,
  dimensions integer not null check (dimensions between 1 and 32768),
  text_hash text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  embedding jsonb not null,
  hit_count bigint not null default 0 check (hit_count >= 0),
  created_at timestamptz not null default now(),
  last_hit_at timestamptz not null default now(),
  primary key (model, dimensions, text_hash),
  check (jsonb_typeof(embedding) = 'array')
);

alter table public.entitlements enable row level security;
alter table public.access_codes enable row level security;
alter table public.access_code_redemptions enable row level security;
alter table public.embedding_usage_periods enable row level security;
alter table public.embedding_rate_buckets enable row level security;
alter table public.embedding_usage enable row level security;
alter table public.embedding_cache enable row level security;

revoke all on table public.entitlements from anon, authenticated;
revoke all on table public.access_codes from anon, authenticated;
revoke all on table public.access_code_redemptions from anon, authenticated;
revoke all on table public.embedding_usage_periods from anon, authenticated;
revoke all on table public.embedding_rate_buckets from anon, authenticated;
revoke all on table public.embedding_usage from anon, authenticated;
revoke all on table public.embedding_cache from anon, authenticated;

grant select, insert, update, delete on table public.entitlements to service_role;
grant select, insert, update, delete on table public.access_codes to service_role;
grant select, insert, update, delete on table public.access_code_redemptions to service_role;
grant select, insert, update, delete on table public.embedding_usage_periods to service_role;
grant select, insert, update, delete on table public.embedding_rate_buckets to service_role;
grant select, insert, update, delete on table public.embedding_usage to service_role;
grant select, insert, update, delete on table public.embedding_cache to service_role;
grant usage, select on sequence public.access_code_redemptions_id_seq to service_role;

create or replace function public.gretel_entitlement_status(p_user_id uuid)
returns table (
  active boolean,
  plan text,
  source text,
  monthly_input_limit integer,
  used_inputs integer,
  remaining_inputs integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entitlement public.entitlements%rowtype;
  v_used integer := 0;
begin
  select * into v_entitlement
  from public.entitlements
  where user_id = p_user_id;

  if not found then
    return query select false, null::text, null::text, 0, 0, 0, null::timestamptz;
    return;
  end if;

  select coalesce(input_count, 0) into v_used
  from public.embedding_usage_periods
  where user_id = p_user_id
    and period_start = date_trunc('month', now())::date;

  return query select
    v_entitlement.status = 'active'
      and (v_entitlement.expires_at is null or v_entitlement.expires_at > now()),
    v_entitlement.plan,
    v_entitlement.source,
    v_entitlement.monthly_input_limit,
    coalesce(v_used, 0),
    greatest(v_entitlement.monthly_input_limit - coalesce(v_used, 0), 0),
    v_entitlement.expires_at;
end;
$$;

create or replace function public.gretel_ensure_google_entitlement(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_anonymous boolean;
begin
  select is_anonymous into v_is_anonymous
  from auth.users
  where id = p_user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;

  if coalesce(v_is_anonymous, false) then
    return;
  end if;

  insert into public.entitlements (
    user_id, plan, source, monthly_input_limit, requests_per_minute,
    max_inputs_per_request, max_characters_per_request
  ) values (
    p_user_id, 'free', 'google', 10000, 60, 32, 120000
  ) on conflict (user_id) do nothing;
end;
$$;

create or replace function public.gretel_redeem_access_code(
  p_user_id uuid,
  p_code_hash_hex text
)
returns table (
  active boolean,
  plan text,
  monthly_input_limit integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code public.access_codes%rowtype;
  v_inserted integer;
begin
  if p_code_hash_hex !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'invalid_access_code';
  end if;

  select * into v_code
  from public.access_codes
  where code_hash = decode(p_code_hash_hex, 'hex')
  for update;

  if not found
    or v_code.revoked_at is not null
    or (v_code.expires_at is not null and v_code.expires_at <= now()) then
    raise exception using errcode = 'P0001', message = 'invalid_access_code';
  end if;

  if exists (
    select 1 from public.access_code_redemptions
    where code_id = v_code.id and user_id = p_user_id
  ) then
    return query select true, v_code.plan, v_code.monthly_input_limit, v_code.entitlement_expires_at;
    return;
  end if;

  if v_code.redemption_count >= v_code.max_redemptions then
    raise exception using errcode = 'P0001', message = 'access_code_redeemed';
  end if;

  insert into public.access_code_redemptions (code_id, user_id)
  values (v_code.id, p_user_id)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return query select true, v_code.plan, v_code.monthly_input_limit, v_code.entitlement_expires_at;
    return;
  end if;

  update public.access_codes
  set redemption_count = redemption_count + 1
  where id = v_code.id;

  insert into public.entitlements (
    user_id, plan, source, monthly_input_limit, requests_per_minute,
    max_inputs_per_request, max_characters_per_request, expires_at
  ) values (
    p_user_id, v_code.plan, 'access_code', v_code.monthly_input_limit,
    v_code.requests_per_minute, v_code.max_inputs_per_request,
    v_code.max_characters_per_request, v_code.entitlement_expires_at
  )
  on conflict (user_id) do update set
    plan = excluded.plan,
    source = excluded.source,
    status = 'active',
    monthly_input_limit = greatest(public.entitlements.monthly_input_limit, excluded.monthly_input_limit),
    requests_per_minute = greatest(public.entitlements.requests_per_minute, excluded.requests_per_minute),
    max_inputs_per_request = greatest(public.entitlements.max_inputs_per_request, excluded.max_inputs_per_request),
    max_characters_per_request = greatest(public.entitlements.max_characters_per_request, excluded.max_characters_per_request),
    expires_at = case
      when public.entitlements.expires_at is null or excluded.expires_at is null then null
      else greatest(public.entitlements.expires_at, excluded.expires_at)
    end,
    updated_at = now();

  return query select true, v_code.plan, v_code.monthly_input_limit, v_code.entitlement_expires_at;
end;
$$;

create or replace function public.gretel_authorize_embedding_request(
  p_request_id uuid,
  p_user_id uuid,
  p_model text,
  p_requested_inputs integer,
  p_cached_inputs integer,
  p_character_count integer
)
returns table (
  monthly_input_limit integer,
  used_inputs integer,
  remaining_inputs integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entitlement public.entitlements%rowtype;
  v_period_start date := date_trunc('month', now())::date;
  v_bucket_start timestamptz := date_trunc('minute', now());
  v_billed integer := greatest(p_requested_inputs - p_cached_inputs, 0);
  v_rate_count integer;
  v_used integer;
begin
  if p_requested_inputs < 1 or p_cached_inputs < 0 or p_cached_inputs > p_requested_inputs then
    raise exception using errcode = 'P0001', message = 'invalid_request_size';
  end if;

  select * into v_entitlement
  from public.entitlements
  where user_id = p_user_id
  for update;

  if not found
    or v_entitlement.status <> 'active'
    or (v_entitlement.expires_at is not null and v_entitlement.expires_at <= now()) then
    raise exception using errcode = 'P0001', message = 'access_required';
  end if;

  if p_requested_inputs > v_entitlement.max_inputs_per_request
    or p_character_count > v_entitlement.max_characters_per_request then
    raise exception using errcode = 'P0001', message = 'request_too_large';
  end if;

  insert into public.embedding_rate_buckets (user_id, bucket_start, request_count)
  values (p_user_id, v_bucket_start, 1)
  on conflict (user_id, bucket_start) do update
    set request_count = public.embedding_rate_buckets.request_count + 1
  returning request_count into v_rate_count;

  if v_rate_count > v_entitlement.requests_per_minute then
    raise exception using errcode = 'P0001', message = 'rate_limit_exceeded';
  end if;

  insert into public.embedding_usage_periods (user_id, period_start, input_count, request_count)
  values (p_user_id, v_period_start, v_billed, 1)
  on conflict (user_id, period_start) do update set
    input_count = public.embedding_usage_periods.input_count + v_billed,
    request_count = public.embedding_usage_periods.request_count + 1,
    updated_at = now()
  returning input_count into v_used;

  if v_used > v_entitlement.monthly_input_limit then
    raise exception using errcode = 'P0001', message = 'quota_exceeded';
  end if;

  insert into public.embedding_usage (
    request_id, user_id, model, requested_inputs, cached_inputs,
    billed_inputs, character_count, status
  ) values (
    p_request_id, p_user_id, p_model, p_requested_inputs, p_cached_inputs,
    v_billed, p_character_count, 'reserved'
  );

  return query select
    v_entitlement.monthly_input_limit,
    v_used,
    greatest(v_entitlement.monthly_input_limit - v_used, 0);
end;
$$;

create or replace function public.gretel_finalize_embedding_request(
  p_request_id uuid,
  p_succeeded boolean,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage public.embedding_usage%rowtype;
begin
  select * into v_usage
  from public.embedding_usage
  where request_id = p_request_id
  for update;

  if not found or v_usage.status <> 'reserved' then
    return;
  end if;

  update public.embedding_usage
  set status = case when p_succeeded then 'succeeded' else 'failed' end,
      error_code = case when p_succeeded then null else left(coalesce(p_error_code, 'upstream_error'), 80) end,
      completed_at = now()
  where request_id = p_request_id;

  if not p_succeeded and v_usage.billed_inputs > 0 then
    update public.embedding_usage_periods
    set input_count = greatest(input_count - v_usage.billed_inputs, 0),
        updated_at = now()
    where user_id = v_usage.user_id
      and period_start = date_trunc('month', v_usage.created_at)::date;
  end if;
end;
$$;

create or replace function public.gretel_create_access_code(
  p_label text default 'Gretel access',
  p_max_redemptions integer default 1,
  p_expires_at timestamptz default null,
  p_entitlement_expires_at timestamptz default null,
  p_monthly_input_limit integer default 25000
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_compact text := upper(encode(gen_random_bytes(10), 'hex'));
  v_code text;
begin
  if p_max_redemptions < 1 or p_monthly_input_limit < 0 then
    raise exception using errcode = 'P0001', message = 'invalid_access_code_limits';
  end if;

  v_code := 'GRTL-' || substr(v_compact, 1, 5) || '-' || substr(v_compact, 6, 5)
    || '-' || substr(v_compact, 11, 5) || '-' || substr(v_compact, 16, 5);

  insert into public.access_codes (
    code_hash, label, max_redemptions, expires_at,
    entitlement_expires_at, monthly_input_limit
  ) values (
    extensions.digest(regexp_replace(v_code, '[^A-Z0-9]', '', 'g'), 'sha256'),
    left(coalesce(nullif(trim(p_label), ''), 'Gretel access'), 120),
    p_max_redemptions, p_expires_at, p_entitlement_expires_at,
    p_monthly_input_limit
  );

  return v_code;
end;
$$;

revoke all on function public.gretel_entitlement_status(uuid) from public, anon, authenticated;
revoke all on function public.gretel_ensure_google_entitlement(uuid) from public, anon, authenticated;
revoke all on function public.gretel_redeem_access_code(uuid, text) from public, anon, authenticated;
revoke all on function public.gretel_authorize_embedding_request(uuid, uuid, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.gretel_finalize_embedding_request(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.gretel_create_access_code(text, integer, timestamptz, timestamptz, integer) from public, anon, authenticated;

grant execute on function public.gretel_entitlement_status(uuid) to service_role;
grant execute on function public.gretel_ensure_google_entitlement(uuid) to service_role;
grant execute on function public.gretel_redeem_access_code(uuid, text) to service_role;
grant execute on function public.gretel_authorize_embedding_request(uuid, uuid, text, integer, integer, integer) to service_role;
grant execute on function public.gretel_finalize_embedding_request(uuid, boolean, text) to service_role;
grant execute on function public.gretel_create_access_code(text, integer, timestamptz, timestamptz, integer) to service_role;

