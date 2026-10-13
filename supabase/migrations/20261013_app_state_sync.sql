-- Applied to the Supabase project via the Supabase connector. Kept here for the record.
-- Single-user sync: the whole OpenGym state as one JSON row, reachable only through the
-- key-checked functions below (RLS on, no policies, so the tables are closed to the API).
-- The key itself is never stored: insert sha256(key) as hex into sync_key.
create table public.app_state (
  id int primary key default 1 check (id = 1),
  state jsonb not null,
  updated_at timestamptz not null default now()
);
create table public.sync_key (
  id int primary key default 1 check (id = 1),
  key_hash text not null
);
alter table public.app_state enable row level security;
alter table public.sync_key enable row level security;

create function public.gym_key_ok(k text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sync_key
                 where key_hash = encode(sha256(convert_to(coalesce(k, ''), 'UTF8')), 'hex'))
$$;

create function public.gym_get(k text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.gym_key_ok(k) then raise exception 'bad key' using errcode = '28000'; end if;
  return (select state from public.app_state where id = 1);
end $$;

create function public.gym_put(k text, s jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.gym_key_ok(k) then raise exception 'bad key' using errcode = '28000'; end if;
  if jsonb_typeof(s) is distinct from 'object' then raise exception 'state required' using errcode = '22023'; end if;
  insert into public.app_state (id, state, updated_at) values (1, s - 'active', now())
  on conflict (id) do update set state = excluded.state, updated_at = now();
end $$;

revoke all on function public.gym_key_ok(text) from public, anon, authenticated;
revoke all on function public.gym_get(text) from public, authenticated;
revoke all on function public.gym_put(text, jsonb) from public, authenticated;
grant execute on function public.gym_get(text) to anon;
grant execute on function public.gym_put(text, jsonb) to anon;
