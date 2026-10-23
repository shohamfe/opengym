-- "Delete account" in Settings (pm-spec P0, architecture.md §7). Its own file because it removes
-- rows, and the Supabase connector cancels any migration that does: Shoham applies this one by
-- hand in the SQL editor (or approves it). Needs 20261023_accounts.sql first. Safe to re-run.
--
-- Push rows have no foreign key to auth.users (20261014_push.sql), so they go by hand first. Then
-- the auth.users row goes, which cascades to gym_state and gym_history and to Supabase's own
-- sessions and identities. Unused reset codes for the account are marked used. Invites it
-- redeemed stay as an audit line (used_by then points at nobody).
-- Unverified: that the function owner (postgres) may remove auth.users rows on the hosted
-- platform. It is the usual community pattern; test it with a throwaway user (qa-plan S13)
-- before shipping the button.
create or replace function public.gym_delete_me() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  perform public.gym_not_ai();
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if exists (select 1 from public.gym_admin where user_id = uid) then
    raise exception 'the admin account cannot be deleted from the app' using errcode = '42501';
  end if;
  delete from public.push_job where user_id = uid;
  delete from public.push_mark where user_id = uid;
  delete from public.push_sub where user_id = uid;
  update public.gym_setup_code set used_at = now() where user_id = uid and used_at is null;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.gym_delete_me() from public, anon, authenticated;
grant execute on function public.gym_delete_me() to authenticated;
