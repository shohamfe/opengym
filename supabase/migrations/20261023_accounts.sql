-- Accounts for more than one person (multi-user, architecture.md 2026-10-23 update U1/U2):
-- invite codes as the sign-up gate, per-user reset codes, an admin "Members & invites" card,
-- a profile slot in the state, and a shared secret on the gym-push poke.
-- Additive only, safe to re-run. No destructive statements here: the connector cancels
-- migrations that contain them. Account deletion and session revoke live in their own files
-- (20261023_zz_*.sql) for that reason.
--
-- Supabase grants EXECUTE on new public functions to anon and authenticated by default, so every
-- function below revokes first and grants only what it needs.

-- Codes: 12 Crockford base32 characters (60 bits; anon RPCs have no rate limit), shown as
-- XXXX-XXXX-XXXX. Only the sha256 of the normalised code is stored. Normalising (upper-case,
-- strip spaces/hyphens, I/L -> 1, O -> 0) lets people type or paste them in any form.
create or replace function public.gym_code_hash(c text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(translate(upper(regexp_replace(coalesce(c, ''), '[^0-9A-Za-z]', '', 'g')), 'ILO', '110'), 'sha256'), 'hex')
$$;
-- 12 random bytes, each mod 32 (256 is a multiple of 32, so no bias).
create or replace function public.gym_code_new() returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', get_byte(r.b, i) % 32 + 1, 1), '' order by i)
  from (select extensions.gen_random_bytes(12) b) r, generate_series(0, 11) i
$$;
revoke all on function public.gym_code_hash(text), public.gym_code_new() from public, anon, authenticated;

-- Same body as in 20261023_ai_client_guard.sql (MCP connector), repeated so this file does not
-- depend on run order: account-level RPCs refuse OAuth tokens issued to connected AI apps.
create or replace function public.gym_not_ai() returns void
language plpgsql stable set search_path = '' as $$
begin
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'not allowed for connected AI apps' using errcode = '42501';
  end if;
end $$;
revoke all on function public.gym_not_ai() from public, anon;

/* ---- admin ---- */
-- A table, not a JWT claim (user_metadata is user-editable), so revoking admin is instant.
-- shortcut: no cascade clause on the foreign key (the connector refuses its keyword); an admin
-- cannot remove their own account anyway (see the account-removal migration, 20261023_zz_*).
create table if not exists public.gym_admin (
  user_id uuid primary key references auth.users (id)
);
alter table public.gym_admin enable row level security;
revoke all on public.gym_admin from public, anon, authenticated;
insert into public.gym_admin (user_id)
select id from auth.users where lower(email) = 'shoham.fe@gmail.com'
on conflict (user_id) do nothing;

create or replace function public.gym_is_admin() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.gym_not_ai();
  return exists (select 1 from public.gym_admin where user_id = auth.uid());
end $$;

create or replace function public.gym_admin_check() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.gym_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
end $$;
revoke all on function public.gym_is_admin(), public.gym_admin_check() from public, anon, authenticated;
grant execute on function public.gym_is_admin() to authenticated;

/* ---- invites ---- */
-- used_by has no foreign key: the gate sets it before the auth.users row exists.
create table if not exists public.gym_invite (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  note text,
  email text,                       -- optional: when set, only this address can redeem the code
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  used_by uuid,
  revoked_at timestamptz
);
alter table public.gym_invite enable row level security;
revoke all on public.gym_invite from public, anon, authenticated;

-- Returns the plain code once; only its hash is kept.
create or replace function public.gym_invite_mint(note text default null, email text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare c text := public.gym_code_new();
begin
  perform public.gym_not_ai();
  perform public.gym_admin_check();
  if length($1) > 80 or length($2) > 254 then raise exception 'too long' using errcode = '22023'; end if;
  insert into public.gym_invite (code_hash, note, email, created_by)
  values (public.gym_code_hash(c), nullif(trim($1), ''), nullif(lower(trim($2)), ''), auth.uid());
  return c;
end $$;

create or replace function public.gym_invite_list()
returns table (id uuid, note text, email text, created_at timestamptz, expires_at timestamptz, status text, used_by_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.gym_not_ai();
  perform public.gym_admin_check();
  return query
  select i.id, i.note, i.email, i.created_at, i.expires_at,
         case when i.used_at is not null then 'used' when i.revoked_at is not null then 'revoked'
              when i.expires_at <= now() then 'expired' else 'open' end,
         u.email::text
  from public.gym_invite i left join auth.users u on u.id = i.used_by
  order by i.created_at desc
  limit 50;
end $$;

-- An update, not a removal: the gate refuses revoked codes.
create or replace function public.gym_invite_revoke(id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.gym_not_ai();
  perform public.gym_admin_check();
  update public.gym_invite i set revoked_at = now() where i.id = $1 and i.used_at is null and i.revoked_at is null;
end $$;

-- Emails only: no state, profile or health fields ever reach the admin.
create or replace function public.gym_admin_users() returns table (user_id uuid, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.gym_not_ai();
  perform public.gym_admin_check();
  return query select u.id, u.email::text from auth.users u order by u.created_at;
end $$;

revoke all on function public.gym_invite_mint(text, text), public.gym_invite_list(), public.gym_invite_revoke(uuid),
  public.gym_admin_users() from public, anon, authenticated;
grant execute on function public.gym_invite_mint(text, text), public.gym_invite_list(), public.gym_invite_revoke(uuid),
  public.gym_admin_users() to authenticated;

/* ---- sign-up gate ---- */
-- Keeps the old name so the trigger already attached to auth.users (20261013_email_auth.sql) runs
-- this body; no trigger is touched. The owner's email still passes without a code. Everyone else
-- needs an open invite in the sign-up metadata ({data: {invite}}), consumed in the same
-- transaction as the user insert: a later failure un-uses it, and of two racing sign-ups the
-- second waits on the row lock, then finds it used. The code is stripped from the metadata.
-- A raise here reaches the client as HTTP 500 "Database error saving new user"; the app maps
-- that to "That code is wrong, expired or already used."
-- Rollback: re-run the body from 20261013_email_auth.sql.
create or replace function public.gym_owner_only() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if lower(coalesce(new.email, '')) <> 'shoham.fe@gmail.com' then
    update public.gym_invite set used_at = now(), used_by = new.id
    where code_hash = public.gym_code_hash(new.raw_user_meta_data ->> 'invite')
      and used_at is null and revoked_at is null and expires_at > now()
      and (email is null or email = lower(new.email));
    if not found then raise exception 'invite code is wrong, expired or used' using errcode = '42501'; end if;
  end if;
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'invite';
  return new;
end $$;
revoke all on function public.gym_owner_only() from public, anon, authenticated;

/* ---- password reset codes ---- */
-- user_id null = a legacy setup code (minted by hand in SQL), only ever for the owner.
alter table public.gym_setup_code add column if not exists user_id uuid;

-- Admin: a reset code for one member, valid 1 hour, shown once.
create or replace function public.gym_reset_mint(user_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c text := public.gym_code_new();
begin
  perform public.gym_not_ai();
  perform public.gym_admin_check();
  if not exists (select 1 from auth.users u where u.id = $1) then raise exception 'no such user' using errcode = '22023'; end if;
  insert into public.gym_setup_code (code_hash, expires_at, user_id) values (public.gym_code_hash(c), now() + interval '1 hour', $1);
  return c;
end $$;
revoke all on function public.gym_reset_mint(uuid) from public, anon, authenticated;
grant execute on function public.gym_reset_mint(uuid) to authenticated;

-- Anon: set the password of the account with this email, with a code minted for that account.
-- Wrong email, wrong/used/expired code all give one error. A legacy code (user_id null) still
-- works for the owner's email only. Ending the user's other sessions is added later, in
-- 20261023_zz_reset_ends_sessions.sql, once the shared-phone fix is on every device (QA C5).
create or replace function public.gym_set_password(email text, code text, pw text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if length(coalesce($3, '')) < 10 then raise exception 'password too short' using errcode = '22023'; end if;
  select u.id into uid from auth.users u where lower(u.email) = lower(trim($1));
  update public.gym_setup_code c set used_at = now()
  where c.code_hash in (public.gym_code_hash($2), encode(extensions.digest(upper(trim($2)), 'sha256'), 'hex'))
    and c.used_at is null and c.expires_at > now()
    and (c.user_id = uid or (c.user_id is null and lower(trim($1)) = 'shoham.fe@gmail.com'));
  if uid is null or not found then raise exception 'code is wrong, expired or used' using errcode = '28000'; end if;
  update auth.users set encrypted_password = extensions.crypt($3, extensions.gen_salt('bf')), updated_at = now()
  where id = uid;
end $$;
revoke all on function public.gym_set_password(text, text, text) from public, authenticated;
grant execute on function public.gym_set_password(text, text, text) to anon;

-- QA C4: the old 2-argument version always sets the owner's password, so it must never accept a
-- code minted for someone else. Same body as 20261014_password_setup.sql plus "user_id is null".
create or replace function public.gym_set_password(code text, pw text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if length(coalesce(pw, '')) < 10 then raise exception 'password too short' using errcode = '22023'; end if;
  update public.gym_setup_code set used_at = now()
  where code_hash = encode(extensions.digest(upper(trim(code)), 'sha256'), 'hex')
    and used_at is null and expires_at > now() and user_id is null;
  if not found then raise exception 'setup code is wrong, expired or used' using errcode = '28000'; end if;
  update auth.users set encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf')), updated_at = now()
  where lower(email) = 'shoham.fe@gmail.com';
end $$;
revoke all on function public.gym_set_password(text, text) from public, authenticated;
grant execute on function public.gym_set_password(text, text) to anon;

/* ---- profile slot in the state ---- */
-- S.profile is an object or null (build plan contract). A separate constraint, so the existing
-- gym_state_shape stays as it is.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'gym_state_profile' and conrelid = 'public.gym_state'::regclass) then
    alter table public.gym_state add constraint gym_state_profile
      check (coalesce(jsonb_typeof(state -> 'profile'), 'null') in ('object', 'null'));
  end if;
end $$;

/* ---- gym-push shared secret ---- */
-- Without it anyone who knows the URL can poke gym-push in a loop and burn the free plan's
-- invocation quota. The cron job sends it in a header; the function reads the same value through
-- a service-role RPC and refuses pokes without it. Generated here, so nobody has to paste it.
create table if not exists public.gym_push_secret (
  id int primary key default 1 check (id = 1),
  secret text not null
);
alter table public.gym_push_secret enable row level security;
revoke all on public.gym_push_secret from public, anon, authenticated;
insert into public.gym_push_secret (id, secret) values (1, encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (id) do nothing;

create or replace function public.push_secret() returns text
language sql stable security definer set search_path = '' as $$
  select secret from public.gym_push_secret where id = 1
$$;
revoke all on function public.push_secret() from public, anon, authenticated;
grant execute on function public.push_secret() to service_role;

-- Same body as in 20261014_push.sql, plus the header.
create or replace function public.push_tick() returns void
language plpgsql set search_path = '' as $$
begin
  perform public.push_compute();
  if exists (select 1 from public.push_job j
             where j.sent_at is null and j.fire_at <= now() and j.fire_at > now() - interval '10 minutes'
               and exists (select 1 from public.push_sub p where p.user_id = j.user_id and not p.disabled)) then
    perform net.http_post(url := 'https://kxmvuvmjbgetjrjtnafv.supabase.co/functions/v1/gym-push',
                          body := '{}'::jsonb, timeout_milliseconds := 20000,
                          headers := jsonb_build_object('Content-Type', 'application/json',
                                                        'x-gym-push-secret', (select secret from public.gym_push_secret where id = 1)));
  end if;
end $$;
revoke all on function public.push_tick() from public, anon, authenticated;
