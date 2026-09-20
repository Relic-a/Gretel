create index managed_allowance_grants_user_created_idx
  on public.managed_allowance_grants (user_id, created_at desc);
