-- These tables are deliberately server-only. Explicit deny policies document that
-- intent and keep the database advisor from treating policy-free RLS as accidental.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'entitlements',
    'access_codes',
    'access_code_redemptions',
    'embedding_usage_periods',
    'embedding_rate_buckets',
    'embedding_usage',
    'embedding_cache'
  ] loop
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
      table_name || '_deny_client_access',
      table_name
    );
  end loop;
end
$$;

create index access_code_redemptions_user_idx
  on public.access_code_redemptions (user_id);
