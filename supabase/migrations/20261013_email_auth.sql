-- Replaces the shared sync key (20261013_app_state_sync.sql) with Supabase Auth: the app signs in
-- with an email one-time code and reads/writes its own row through gym_get / gym_put.
-- Applied through the Supabase connector; kept here for the record. Safe to re-run: it creates or
-- replaces objects without touching their data.
--
-- Editing as the database owner (Claude, via SQL) keeps working: RLS does not apply to the owner,
-- and the stamp trigger below gives every write a fresh server _ts, so the app sees the edit as
-- newer and a phone with an older copy cannot silently overwrite it (gym_put answers 409). E.g.
--   update public.gym_state set state = jsonb_set(state, '{restSec}', '120')
--   where user_id = (select id from auth.users where email = 'shoham.fe@gmail.com');
-- Every update keeps the previous row in gym_state_history (last 20 per user). Undo the last write:
--   update public.gym_state a set state = h.state from (select state from public.gym_state_history
--   where user_id = <uid> order by id desc limit 1) h where a.user_id = <uid>;

-- Old key-based sync: closed off rather than dropped (the connector won't run destructive
-- statements unattended). Its tables (app_state, sync_key) are empty and can be dropped any time.
revoke all on function public.gym_get(text) from public, anon, authenticated;
revoke all on function public.gym_put(text, jsonb) from public, anon, authenticated;

-- Only the owner can get an account. Rejecting the insert makes Supabase Auth refuse the sign-up
-- before any email is sent (auth hooks would need the dashboard; a trigger is plain SQL).
create or replace function public.gym_owner_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if lower(coalesce(new.email, '')) <> 'shoham.fe@gmail.com' then
    raise exception 'sign-up is closed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.gym_owner_only() from public, anon, authenticated;
drop trigger if exists gym_owner_only on auth.users;
create trigger gym_owner_only before insert on auth.users
  for each row execute function public.gym_owner_only();

-- One row per user with the whole app state. RLS on with no policies: closed to the API except
-- through the functions below.
create table if not exists public.gym_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.gym_state enable row level security;
-- The shape the app relies on: a bad write (from SQL or a device) fails here instead of crashing
-- the app on its next load.
alter table public.gym_state drop constraint if exists gym_state_shape;
alter table public.gym_state add constraint gym_state_shape check (
  jsonb_typeof(state) = 'object'
  and coalesce(jsonb_typeof(state->'routines'), 'array') = 'array'
  and coalesce(jsonb_typeof(state->'workouts'), 'array') = 'array'
  and coalesce(jsonb_typeof(state->'bodyweight'), 'array') = 'array'
  and coalesce(jsonb_typeof(state->'customEx'), 'array') = 'array'
  and coalesce(jsonb_typeof(state->'week'), 'object') = 'object'
  and coalesce(jsonb_typeof(state->'dayPlan'), 'object') = 'object'
);

-- Previous versions of each row, for undoing a bad write. Closed to the API like gym_state.
create table if not exists public.gym_state_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  state jsonb not null,
  saved_at timestamptz not null default now()
);
create index if not exists gym_state_history_user on public.gym_state_history (user_id, id);
alter table public.gym_state_history enable row level security;

-- Every write, from the app or from plain SQL, gets a server _ts (ms) and loses the device-only
-- in-progress workout.
create or replace function public.gym_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(new.state) is distinct from 'object' then
    raise exception 'state must be a JSON object' using errcode = '23514';
  end if;
  new.updated_at := clock_timestamp();
  new.state := jsonb_set(new.state - 'active', '{_ts}',
                         to_jsonb((extract(epoch from new.updated_at) * 1000)::bigint));
  return new;
end $$;
revoke all on function public.gym_stamp() from public, anon, authenticated;
drop trigger if exists gym_stamp on public.gym_state;
create trigger gym_stamp before insert or update on public.gym_state
  for each row execute function public.gym_stamp();

create or replace function public.gym_keep_history() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into public.gym_state_history (user_id, state) values (old.user_id, old.state);
  delete from public.gym_state_history
  where user_id = old.user_id
    and id not in (select id from public.gym_state_history where user_id = old.user_id order by id desc limit 20);
  return null;
end $$;
revoke all on function public.gym_keep_history() from public, anon, authenticated;
drop trigger if exists gym_keep_history on public.gym_state;
create trigger gym_keep_history after update on public.gym_state
  for each row execute function public.gym_keep_history();

create or replace function public.gym_get() returns jsonb
language sql stable security definer set search_path = '' as $$
  select state from public.gym_state where user_id = auth.uid()
$$;

-- base = the server _ts the device's copy is built on. If the row has changed since (someone else
-- wrote, e.g. Claude), refuse with HTTP 409 so the device merges with the server copy instead.
-- Returns the new server _ts.
create or replace function public.gym_put(s jsonb, base bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cur bigint;
  ts bigint;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if jsonb_typeof(s) is distinct from 'object' then raise exception 'state required' using errcode = '22023'; end if;
  select (state->>'_ts')::bigint into cur from public.gym_state where user_id = uid for update;
  if found and cur is distinct from base then
    raise exception 'state changed on the server' using errcode = 'PT409';
  end if;
  insert into public.gym_state (user_id, state) values (uid, s)
  on conflict (user_id) do update set state = excluded.state
  returning (state->>'_ts')::bigint into ts;
  return ts;
end $$;

revoke all on function public.gym_get() from public, anon;
revoke all on function public.gym_put(jsonb, bigint) from public, anon;
grant execute on function public.gym_get() to authenticated;
grant execute on function public.gym_put(jsonb, bigint) to authenticated;
