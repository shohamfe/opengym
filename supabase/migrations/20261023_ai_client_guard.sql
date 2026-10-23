-- Connected AI apps (the gym-mcp connector) sign in through the Supabase OAuth 2.1 server. Their
-- access tokens are ordinary user tokens plus a client_id claim, so on their own they could call
-- every RPC the app can. Rule: an AI may edit training data (gym_get / gym_put), never the account.
-- Every account-level RPC starts with `perform public.gym_not_ai();`. The functions added on the
-- multi-user branch (invites, admin, reset codes, account removal) call it too; this file covers
-- the ones that already exist. Additive only: create or replace keeps the existing grants.

create or replace function public.gym_not_ai() returns void
language plpgsql stable set search_path = '' as $$
begin
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'not allowed for connected AI apps' using errcode = '42501';
  end if;
end $$;
comment on function public.gym_not_ai() is
  'Raises when the caller''s token came from the OAuth server (client_id claim): account-level RPCs call it first.';
grant execute on function public.gym_not_ai() to authenticated;

-- Push subscriptions decide which device gets this user's alerts: account-level. Bodies as in
-- 20261014_push.sql (latest versions) with the guard added first.
create or replace function public.push_subscribe(sub jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.gym_not_ai();
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if coalesce(sub->>'endpoint', '') !~ '^https://' or length(sub->>'endpoint') > 1000
     or coalesce(sub->'keys'->>'p256dh', '') = '' or coalesce(sub->'keys'->>'auth', '') = '' then
    raise exception 'invalid subscription' using errcode = '22023';
  end if;
  insert into public.push_sub (endpoint, user_id, keys)
  values (sub->>'endpoint', auth.uid(), jsonb_build_object('p256dh', sub->'keys'->>'p256dh', 'auth', sub->'keys'->>'auth'))
  on conflict (endpoint) do update set user_id = excluded.user_id, keys = excluded.keys, created = now(), disabled = false
  where public.push_sub.user_id = auth.uid() or public.push_sub.disabled;
end $$;

create or replace function public.push_unsubscribe(endpoint text) returns void
language sql security definer set search_path = '' as $$
  update public.push_sub s set disabled = true
  where s.endpoint = push_unsubscribe.endpoint and s.user_id = auth.uid() and (auth.jwt() ->> 'client_id') is null
$$;

create or replace function public.push_test() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.gym_not_ai();
  if not exists (select 1 from public.push_sub where user_id = auth.uid() and not disabled) then
    raise exception 'no push subscription' using errcode = 'P0002';
  end if;
  insert into public.push_job (user_id, kind, fire_at, payload)
  values (auth.uid(), 'test', now(), '{"title":"openGym","body":"Test notification ✅ — this is what alerts look like.","tag":"test"}')
  on conflict (user_id, kind) do update set fire_at = now(), payload = excluded.payload, sent_at = null;
end $$;
