-- A password reset with a code also signs that account out everywhere (architecture.md §1.2 point 1),
-- so a reset after a stolen password locks the thief out at their next token refresh (access
-- tokens already issued live until they expire, at most 1 hour).
--
-- DO NOT APPLY YET. Only once the shared-phone fix (gym_owner tag, frontend) is live on every
-- device and each user has opened the app once on that build (qa-plan C5, architecture U1/U3):
-- an ended session on an old build is exactly what leaks one account's data into the next one
-- that signs in on that phone.
-- Its own file because it removes rows (auth.sessions): the connector cancels such migrations, so
-- Shoham runs it in the SQL editor. Needs 20261023_accounts.sql first. Safe to re-run.
-- Unverified: that postgres may remove auth.sessions rows on the hosted platform (the same kind
-- of auth-schema write gym_set_password already makes to auth.users). Check with qa-plan S5.
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
  -- Anon call: there is no "this device" session to keep, so every session of the account ends.
  -- The app signs in again right after the reset, which makes a fresh one.
  delete from auth.sessions where user_id = uid;
end $$;
revoke all on function public.gym_set_password(text, text, text) from public, authenticated;
grant execute on function public.gym_set_password(text, text, text) to anon;
