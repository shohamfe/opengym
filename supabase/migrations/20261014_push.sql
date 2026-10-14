-- Web Push for the static (Supabase) build. Applied through the Supabase connector; kept here for
-- the record. Safe to re-run. No destructive statements anywhere (the connector cancels migrations with them):
-- rows are retired with flags (push_sub.disabled, push_job.sent_at).
--
-- Flow: the app upserts one job per (user, kind) for client-timed alerts (rest, stale); push_tick
-- (pg_cron, every 5 s) adds server-computed ones (day, streak, weigh) from gym_state and, only when
-- something is due, POSTs the gym-push Edge Function, which claims due jobs and sends them.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- shortcut: no foreign key to auth.users (its cascade clause trips the connector); single owner, rows stay tiny.
create table if not exists public.push_sub (
  endpoint text primary key,
  user_id uuid not null,
  keys jsonb not null,
  created timestamptz not null default now(),
  disabled boolean not null default false
);
create table if not exists public.push_job (
  user_id uuid not null,
  kind text not null check (kind in ('rest', 'stale', 'day', 'streak', 'weigh', 'test')),
  fire_at timestamptz not null,
  payload jsonb not null default '{}',
  sent_at timestamptz,
  primary key (user_id, kind)
);
-- Last local date each server-computed type fired, so each fires at most once a day.
create table if not exists public.push_mark (
  user_id uuid not null,
  kind text not null,
  d date not null,
  primary key (user_id, kind)
);
create table if not exists public.push_vapid (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null
);
alter table public.push_sub enable row level security;
alter table public.push_job enable row level security;
alter table public.push_mark enable row level security;
alter table public.push_vapid enable row level security;
revoke all on public.push_sub, public.push_job, public.push_mark, public.push_vapid from public, anon, authenticated;

/* ---- app (authenticated) ---- */
create or replace function public.push_public_key() returns text
language sql stable security definer set search_path = '' as $$
  select public_key from public.push_vapid where id = 1
$$;

create or replace function public.push_subscribe(sub jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if coalesce(sub->>'endpoint', '') !~ '^https://' or length(sub->>'endpoint') > 1000
     or coalesce(sub->'keys'->>'p256dh', '') = '' or coalesce(sub->'keys'->>'auth', '') = '' then
    raise exception 'invalid subscription' using errcode = '22023';
  end if;
  insert into public.push_sub (endpoint, user_id, keys)
  values (sub->>'endpoint', auth.uid(), jsonb_build_object('p256dh', sub->'keys'->>'p256dh', 'auth', sub->'keys'->>'auth'))
  on conflict (endpoint) do update set user_id = excluded.user_id, keys = excluded.keys, created = now(), disabled = false;
end $$;

create or replace function public.push_unsubscribe(endpoint text) returns void
language sql security definer set search_path = '' as $$
  update public.push_sub s set disabled = true where s.endpoint = push_unsubscribe.endpoint and s.user_id = auth.uid()
$$;

-- Client-timed alerts. +2 s grace: an on-screen finish cancels before the push goes out.
create or replace function public.push_schedule(kind text, seconds int, title text, body text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if kind not in ('rest', 'stale') then raise exception 'bad kind' using errcode = '22023'; end if;
  insert into public.push_job (user_id, kind, fire_at, payload, sent_at)
  values (auth.uid(), kind, now() + make_interval(secs => greatest(1, least(21600, coalesce(seconds, 0))) + 2),
          jsonb_build_object('title', left(coalesce(title, 'openGym'), 80), 'body', left(coalesce(body, ''), 200),
                             'tag', case kind when 'rest' then 'rest' else 'stale-workout' end), null)
  on conflict on constraint push_job_pkey do update set fire_at = excluded.fire_at, payload = excluded.payload, sent_at = null;
end $$;

create or replace function public.push_cancel(kind text) returns void
language sql security definer set search_path = '' as $$
  update public.push_job j set sent_at = now()
  where j.user_id = auth.uid() and j.kind = push_cancel.kind and j.sent_at is null
$$;

create or replace function public.push_test() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.push_sub where user_id = auth.uid() and not disabled) then
    raise exception 'no push subscription' using errcode = 'P0002';
  end if;
  insert into public.push_job (user_id, kind, fire_at, payload)
  values (auth.uid(), 'test', now(), '{"title":"openGym","body":"Test notification ✅ — this is what alerts look like.","tag":"test"}')
  on conflict (user_id, kind) do update set fire_at = now(), payload = excluded.payload, sent_at = null;
end $$;

/* ---- server-computed types ---- */
create or replace function public.push_enqueue(uid uuid, k text, d date, title text, body text, tag text) returns void
language sql set search_path = '' as $$
  insert into public.push_job (user_id, kind, fire_at, payload, sent_at)
  values (uid, k, now(), jsonb_build_object('title', title, 'body', body, 'tag', tag), null)
  on conflict (user_id, kind) do update set fire_at = now(), payload = excluded.payload, sent_at = null;
  insert into public.push_mark (user_id, kind, d) values (uid, k, d)
  on conflict (user_id, kind) do update set d = excluded.d;
$$;

-- Fires in [hhmm, hhmm + 60 min) local: a missed tick still fires, turning it on later that day does not.
create or replace function public.push_in_window(lt timestamp, hhmm text) returns boolean
language sql immutable set search_path = '' as $$
  select lt >= lt::date + hhmm::time and lt < lt::date + hhmm::time + interval '60 minutes'
$$;

-- One user's state at time t0 (a parameter so SQL can test any clock). Rules: notify PM spec §2;
-- effectiveRoutineId/weekKey mirror frontend/src/lib.
create or replace function public.push_compute_one(uid uuid, s jsonb, t0 timestamptz) returns void
language plpgsql set search_path = '' as $$
declare
  lt timestamp; today date; dow int; ws int; wk date; n int;
  rem jsonb; nt jsonb; ov text; rid text; rt jsonb; weeks date[];
begin
  rem := coalesce(s->'reminder', '{}');
  nt := '{"streak":false,"weigh":false,"weighDay":1,"weighTime":"08:00"}'::jsonb || coalesce(s->'notify', '{}');
  lt := t0 at time zone coalesce(nullif(rem->>'tz', ''), 'UTC');
  today := lt::date;
  dow := extract(dow from today)::int;

  if coalesce((rem->>'on')::boolean, false) and public.push_in_window(lt, coalesce(rem->>'time', '08:00'))
     and not exists (select 1 from public.push_mark m where m.user_id = uid and m.kind = 'day' and m.d = today)
     and not exists (select 1 from jsonb_array_elements(coalesce(s->'workouts', '[]')) w where w->>'d' = today::text) then
    ov := s->'dayPlan'->>today::text;
    rid := case when ov = 'rest' then null
                when ov is not null and exists (select 1 from jsonb_array_elements(coalesce(s->'routines', '[]')) x where x->>'id' = ov) then ov
                else s->'week'->>dow::text end;
    if rid is not null then
      select x into rt from jsonb_array_elements(coalesce(s->'routines', '[]')) x where x->>'id' = rid limit 1;
      perform public.push_enqueue(uid, 'day', today,
        case when rt is null then 'Workout planned today'
             else coalesce(nullif(rt->>'emoji', '') || ' ', '') || (rt->>'name') || ' today' end,
        'It''s on your plan, let''s go 💪', 'day-reminder');
    end if;
  end if;

  ws := coalesce((s->>'weekStart')::int, 1);
  if (nt->>'streak')::boolean and dow = (ws + 6) % 7 and public.push_in_window(lt, coalesce(rem->>'time', '08:00'))
     and not exists (select 1 from public.push_mark m where m.user_id = uid and m.kind in ('day', 'streak') and m.d = today) then
    wk := today - (dow - ws + 7) % 7;
    select array_agg(distinct x.d - (extract(dow from x.d)::int - ws + 7) % 7) into weeks
    from (select (w->>'d')::date as d from jsonb_array_elements(coalesce(s->'workouts', '[]')) w) x;
    if not (wk = any(coalesce(weeks, '{}'))) and (wk - 7) = any(coalesce(weeks, '{}')) then
      n := 1;
      while (wk - 7 * (n + 1)) = any(weeks) loop n := n + 1; end loop;
      perform public.push_enqueue(uid, 'streak', today, 'Keep your ' || n || '-week streak',
        'No workout yet this week. Today is the last day.', 'streak');
    end if;
  end if;

  if (nt->>'weigh')::boolean and dow = (nt->>'weighDay')::int and public.push_in_window(lt, coalesce(nt->>'weighTime', '08:00'))
     and not exists (select 1 from public.push_mark m where m.user_id = uid and m.kind = 'weigh' and m.d = today)
     and not exists (select 1 from jsonb_array_elements(coalesce(s->'bodyweight', '[]')) b where (b->>'d')::date >= today - 6) then
    perform public.push_enqueue(uid, 'weigh', today, 'Weigh-in day ⚖️', 'Log your bodyweight to keep the trend honest.', 'weigh-in');
  end if;
end $$;

create or replace function public.push_compute() returns void
language plpgsql set search_path = '' as $$
declare r record;
begin
  for r in select g.user_id, g.state from public.gym_state g
           where exists (select 1 from public.push_sub p where p.user_id = g.user_id and not p.disabled) loop
    begin
      perform public.push_compute_one(r.user_id, r.state, now());
    exception when others then
      raise warning 'push_compute skipped user %: %', r.user_id, sqlerrm;   -- bad tz/time in one state must not stop the rest
    end;
  end loop;
end $$;

-- Jobs older than 10 min are never sent: a "rest over" that late is noise.
create or replace function public.push_tick() returns void
language plpgsql set search_path = '' as $$
begin
  perform public.push_compute();
  if exists (select 1 from public.push_job j
             where j.sent_at is null and j.fire_at <= now() and j.fire_at > now() - interval '10 minutes'
               and exists (select 1 from public.push_sub p where p.user_id = j.user_id and not p.disabled)) then
    perform net.http_post(url := 'https://kxmvuvmjbgetjrjtnafv.supabase.co/functions/v1/gym-push',
                          body := '{}'::jsonb, timeout_milliseconds := 20000);
  end if;
end $$;

/* ---- Edge Function (service role) ---- */
-- Claims every due job (sent_at set atomically, so overlapping pokes never double-send) and returns
-- the ones still wanted, with the user's live subscriptions. rest/stale re-check S.notify here.
create or replace function public.push_claim() returns jsonb
language sql security definer set search_path = '' as $$
  with c as (
    update public.push_job j set sent_at = now()
    where j.sent_at is null and j.fire_at <= now()
    returning j.user_id, j.kind, j.fire_at, j.payload
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'payload', c.payload, 'subs', s.subs)), '[]')
  from c
  cross join lateral (select jsonb_agg(jsonb_build_object('endpoint', p.endpoint, 'keys', p.keys)) subs
                      from public.push_sub p where p.user_id = c.user_id and not p.disabled) s
  left join public.gym_state g on g.user_id = c.user_id
  where s.subs is not null and c.fire_at > now() - interval '10 minutes'
    and (c.kind not in ('rest', 'stale') or coalesce((g.state->'notify'->>c.kind)::boolean, true))
$$;

create or replace function public.push_gone(endpoints text[]) returns void
language sql security definer set search_path = '' as $$
  update public.push_sub set disabled = true where endpoint = any(endpoints)
$$;

create or replace function public.push_vapid_get() returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(v) from public.push_vapid v where id = 1
$$;

-- First writer wins, so two cold starts racing still agree on one keypair.
create or replace function public.push_vapid_put(pub text, priv text) returns jsonb
language sql security definer set search_path = '' as $$
  insert into public.push_vapid (id, public_key, private_key) values (1, pub, priv) on conflict (id) do nothing;
  select to_jsonb(v) from public.push_vapid v where id = 1;
$$;

revoke all on function public.push_public_key(), public.push_subscribe(jsonb), public.push_unsubscribe(text),
  public.push_schedule(text, int, text, text), public.push_cancel(text), public.push_test() from public, anon;
grant execute on function public.push_public_key(), public.push_subscribe(jsonb), public.push_unsubscribe(text),
  public.push_schedule(text, int, text, text), public.push_cancel(text), public.push_test() to authenticated;
revoke all on function public.push_enqueue(uuid, text, date, text, text, text), public.push_in_window(timestamp, text),
  public.push_compute_one(uuid, jsonb, timestamptz), public.push_compute(), public.push_tick(), public.push_claim(), public.push_gone(text[]),
  public.push_vapid_get(), public.push_vapid_put(text, text) from public, anon, authenticated;
grant execute on function public.push_claim(), public.push_gone(text[]), public.push_vapid_get(),
  public.push_vapid_put(text, text) to service_role;

select cron.schedule('gym-push', '5 seconds', 'select public.push_tick()');
