-- Password sign-in. The free plan's email can only carry a link, and iOS link previews use it up,
-- so the owner sets a password once with a single-use setup code that Claude creates via SQL:
--   insert into public.gym_setup_code (code_hash, expires_at)
--   values (encode(extensions.digest('<code>', 'sha256'), 'hex'), now() + interval '1 hour');
-- No DROP/DELETE here: the Supabase connector cancels migrations that contain them.
create table if not exists public.gym_setup_code (
  code_hash text primary key,
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table public.gym_setup_code enable row level security;
revoke all on public.gym_setup_code from public, anon, authenticated;

create or replace function public.gym_set_password(code text, pw text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if length(coalesce(pw, '')) < 10 then raise exception 'password too short' using errcode = '22023'; end if;
  update public.gym_setup_code set used_at = now()
  where code_hash = encode(extensions.digest(upper(trim(code)), 'sha256'), 'hex')
    and used_at is null and expires_at > now();
  if not found then raise exception 'setup code is wrong, expired or used' using errcode = '28000'; end if;
  update auth.users set encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf')), updated_at = now()
  where lower(email) = 'shoham.fe@gmail.com';
end $$;
revoke all on function public.gym_set_password(text, text) from public, authenticated;
grant execute on function public.gym_set_password(text, text) to anon;
