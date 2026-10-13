-- Replaces the shared sync key (20261013_app_state_sync.sql) with Supabase Auth: the app signs in
-- with an email one-time code and reads/writes its own row through gym_get / gym_put.
-- Applied through the Supabase connector; kept here for the record. At the time of writing
-- app_state and sync_key were empty, so nothing is copied over.
--
-- Editing as the database owner (Claude, via SQL) keeps working: RLS does not apply to the owner,
-- and the stamp trigger below gives every write a fresh server _ts, so the app sees the edit as
-- newer and a phone with an older copy cannot silently overwrite it (gym_put answers 409). E.g.
--   update public.app_state set state = jsonb_set(state, '{restSec}', '120')
--   where user_id = (select id from auth.users where email = 'shoham.fe@gmail.com');

drop function if exists public.gym_get(text);
drop function if exists public.gym_put(text, jsonb);
drop function if exists public.gym_key_ok(text);
drop table if exists public.sync_key;
drop table if exists public.app_state;

-- Only the owner can get an account. Rejecting the insert makes Supabase Auth refuse the sign-up
-- before any email is sent (auth hooks would need the dashboard; a trigger is plain SQL).
create function public.gym_owner_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if lower(coalesce(new.email, '')) <> 'shoham.fe@gmail.com' then
    raise exception 'sign-up is closed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.gym_owner_only() from public, anon, authenticated;
create trigger gym_owner_only before insert on auth.users
  for each row execute function public.gym_owner_only();

-- One row per user with the whole app state. RLS on with no policies: closed to the API except
-- through the functions below.
create table public.app_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.app_state enable row level security;

-- Every write, from the app or from plain SQL, gets a server _ts (ms) and loses the device-only
-- in-progress workout.
create function public.gym_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  new.state := jsonb_set(new.state - 'active', '{_ts}',
                         to_jsonb((extract(epoch from new.updated_at) * 1000)::bigint));
  return new;
end $$;
revoke all on function public.gym_stamp() from public, anon, authenticated;
create trigger gym_stamp before insert or update on public.app_state
  for each row execute function public.gym_stamp();

create function public.gym_get() returns jsonb
language sql stable security definer set search_path = '' as $$
  select state from public.app_state where user_id = auth.uid()
$$;

-- base = the server _ts the device's copy is built on. If the row has changed since (someone else
-- wrote, e.g. Claude), refuse with HTTP 409 so the device takes the server copy instead.
-- Returns the new server _ts.
create function public.gym_put(s jsonb, base bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cur bigint;
  ts bigint;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if jsonb_typeof(s) is distinct from 'object' then raise exception 'state required' using errcode = '22023'; end if;
  select (state->>'_ts')::bigint into cur from public.app_state where user_id = uid for update;
  if found and cur is distinct from base then
    raise exception 'state changed on the server' using errcode = 'PT409';
  end if;
  insert into public.app_state (user_id, state) values (uid, s)
  on conflict (user_id) do update set state = excluded.state
  returning (state->>'_ts')::bigint into ts;
  return ts;
end $$;

revoke all on function public.gym_get() from public, anon;
revoke all on function public.gym_put(jsonb, bigint) from public, anon;
grant execute on function public.gym_get() to authenticated;
grant execute on function public.gym_put(jsonb, bigint) to authenticated;
