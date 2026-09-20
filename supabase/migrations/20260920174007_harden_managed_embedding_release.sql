-- Audit every manual allowance adjustment. This table and its mutation function
-- are intentionally unavailable to browser roles.
create table public.managed_allowance_grants (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount <> 0 and amount between -1000000 and 1000000),
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  granted_by text not null,
  created_at timestamptz not null default now()
);

alter table public.managed_allowance_grants enable row level security;
revoke all on table public.managed_allowance_grants from public, anon, authenticated;
revoke all on sequence public.managed_allowance_grants_id_seq from public, anon, authenticated;
grant select, insert on table public.managed_allowance_grants to service_role;
grant usage, select on sequence public.managed_allowance_grants_id_seq to service_role;

create policy managed_allowance_grants_deny_client_access
  on public.managed_allowance_grants for all to anon, authenticated
  using (false) with check (false);

create or replace function public.gretel_grant_managed_inputs(
  p_user_id uuid,
  p_amount integer,
  p_reason text
)
returns table (
  user_id uuid,
  monthly_input_limit integer,
  granted_amount integer,
  granted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entitlement public.entitlements%rowtype;
  v_grant public.managed_allowance_grants%rowtype;
begin
  if p_user_id is null
    or p_amount is null
    or p_amount = 0
    or p_amount < -1000000
    or p_amount > 1000000
    or char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception using errcode = 'P0001', message = 'invalid_allowance_grant';
  end if;

  select * into v_entitlement
  from public.entitlements
  where public.entitlements.user_id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'entitlement_not_found';
  end if;

  if v_entitlement.monthly_input_limit + p_amount < 0 then
    raise exception using errcode = 'P0001', message = 'allowance_below_zero';
  end if;

  update public.entitlements
  set monthly_input_limit = monthly_input_limit + p_amount,
      updated_at = now()
  where public.entitlements.user_id = p_user_id
  returning * into v_entitlement;

  insert into public.managed_allowance_grants (user_id, amount, reason, granted_by)
  values (p_user_id, p_amount, trim(p_reason), session_user)
  returning * into v_grant;

  return query select v_entitlement.user_id, v_entitlement.monthly_input_limit,
    v_grant.amount, v_grant.created_at;
end;
$$;

revoke all on function public.gretel_grant_managed_inputs(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.gretel_grant_managed_inputs(uuid, integer, text)
  to service_role;

-- Refund reservations abandoned by a timed-out or terminated Edge Function.
-- The entitlement row lock in authorization serializes this cleanup with quota
-- reservation for the same user.
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
  v_stale_refund integer := 0;
  v_concurrent integer;
begin
  if p_model <> 'qwen/qwen3-embedding-8b'
    or p_requested_inputs < 1 or p_requested_inputs > 32
    or p_cached_inputs < 0 or p_cached_inputs > p_requested_inputs
    or p_character_count < 1 or p_character_count > 60000 then
    raise exception using errcode = 'P0001', message = 'invalid_request_size';
  end if;

  select * into v_entitlement
  from public.entitlements
  where public.entitlements.user_id = p_user_id
  for update;

  if not found
    or v_entitlement.status <> 'active'
    or (v_entitlement.expires_at is not null and v_entitlement.expires_at <= now()) then
    raise exception using errcode = 'P0001', message = 'access_required';
  end if;

  select coalesce(sum(billed_inputs), 0)::integer into v_stale_refund
  from public.embedding_usage
  where user_id = p_user_id and status = 'reserved'
    and created_at >= v_period_start
    and created_at < now() - interval '5 minutes';

  update public.embedding_usage
  set status = 'failed', error_code = 'reservation_expired', completed_at = now()
  where user_id = p_user_id and status = 'reserved'
    and created_at < now() - interval '5 minutes';

  if v_stale_refund > 0 then
    update public.embedding_usage_periods
    set input_count = greatest(input_count - v_stale_refund, 0), updated_at = now()
    where user_id = p_user_id and period_start = v_period_start;
  end if;

  select count(*)::integer into v_concurrent
  from public.embedding_usage
  where user_id = p_user_id and status = 'reserved';
  if v_concurrent >= 4 then
    raise exception using errcode = 'P0001', message = 'concurrency_limit_exceeded';
  end if;

  if p_requested_inputs > least(v_entitlement.max_inputs_per_request, 32)
    or p_character_count > least(v_entitlement.max_characters_per_request, 60000) then
    raise exception using errcode = 'P0001', message = 'request_too_large';
  end if;

  insert into public.embedding_rate_buckets (user_id, bucket_start, request_count)
  values (p_user_id, v_bucket_start, 1)
  on conflict (user_id, bucket_start) do update
    set request_count = public.embedding_rate_buckets.request_count + 1
  returning request_count into v_rate_count;
  if v_rate_count > least(v_entitlement.requests_per_minute, 60) then
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

  return query select v_entitlement.monthly_input_limit, v_used,
    greatest(v_entitlement.monthly_input_limit - v_used, 0);
end;
$$;

revoke all on function public.gretel_authorize_embedding_request(uuid, uuid, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.gretel_authorize_embedding_request(uuid, uuid, text, integer, integer, integer)
  to service_role;
