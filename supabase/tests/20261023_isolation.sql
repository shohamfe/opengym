-- Account isolation checks from qa-plan.md §3.2 (S0-S13), for after 20261023_accounts.sql (and,
-- when applied, the two 20261023_zz_*.sql files). Run as postgres in the SQL editor. Everything
-- happens inside one transaction that ends in ROLLBACK: two throwaway users (A, B) are created,
-- tested and gone again; Shoham's row is only read. Plain SQL, no psql commands.
-- Each check raises a notice "PASS <name>" or a warning "FAIL <name>"; the last result row says
-- how many failed and names them. Checks for a migration that is not applied yet are skipped.
-- Not covered here: S8 (two parallel sign-ups need two connections; the gate's row lock is what
-- makes it safe), S10 (HTTP sign-up and Auth logs), S14 (MCP), and the HTTP-level repeat of S2.
-- Sign-ups are plain inserts into auth.users as postgres: the gate trigger runs exactly as it
-- does for Supabase Auth, but Auth's own checks (password policy etc.) do not.
begin;

create function pg_temp.ok(c boolean, name text) returns void language plpgsql as $$
begin
  if coalesce(c, false) then raise notice 'PASS %', name;
  else
    raise warning 'FAIL %', name;
    perform set_config('t.fail', (coalesce(nullif(current_setting('t.fail', true), ''), '0')::int + 1)::text, true);
    perform set_config('t.failed', concat_ws(' | ', nullif(current_setting('t.failed', true), ''), name), true);
  end if;
end $$;
-- Act as a user (uid), as anon (null), or with extra JWT claims.
create function pg_temp.act(uid uuid, extra jsonb default '{}') returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', (case when uid is null then '{"role":"anon"}'::jsonb
    else jsonb_build_object('sub', uid, 'role', 'authenticated') end || extra)::text, true);
  perform set_config('role', case when uid is null then 'anon' else 'authenticated' end, true);
end $$;
create function pg_temp.su() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- Runs a statement; returns its error text, or null when it succeeded.
create function pg_temp.err(q text) returns text language plpgsql as $$
begin
  execute q;
  return null;
exception when others then return sqlerrm;
end $$;
create function pg_temp.signup(id uuid, email text, invite text) returns text language sql as $$
  select pg_temp.err(format('insert into auth.users (id, email, raw_user_meta_data, aud, role) values (%L, %L, %L, %L, %L)',
    id, email, case when invite is null then '{}' else jsonb_build_object('invite', invite)::text end, 'authenticated', 'authenticated'))
$$;
create function pg_temp.g(k text) returns text language sql stable as $$ select current_setting('t.' || k, true) $$;
create function pg_temp.pw(uid uuid) returns text language sql stable as $$ select md5(coalesce(encrypted_password, '')) from auth.users where id = uid $$;

select set_config('t.a', '0a0a0a0a-0000-4000-8000-000000000001', true),
       set_config('t.b', '0a0a0a0a-0000-4000-8000-000000000002', true),
       set_config('t.shoham', (select id::text from auth.users where lower(email) = 'shoham.fe@gmail.com'), true);

-- S0: snapshot Shoham (re-checked at the end).
select set_config('t.s_state', coalesce((select md5(state::text) from public.gym_state where user_id = pg_temp.g('shoham')::uuid), 'none'), true),
       set_config('t.s_pw', pg_temp.pw(pg_temp.g('shoham')::uuid), true),
       set_config('t.s_push', (select count(*)::text from public.push_sub where user_id = pg_temp.g('shoham')::uuid), true);

-- Invites, minted as Shoham through the admin RPCs.
select pg_temp.act(pg_temp.g('shoham')::uuid);
select pg_temp.ok(public.gym_is_admin(), 'admin: Shoham is admin');
select set_config('t.inv_a', public.gym_invite_mint('qa A', 'QA-A@example.invalid'), true),
       set_config('t.inv_b', public.gym_invite_mint('qa B', null), true),
       set_config('t.inv_x', public.gym_invite_mint('qa expired', null), true),
       set_config('t.inv_r', public.gym_invite_mint('qa revoked', null), true);
select pg_temp.ok(pg_temp.g('inv_a') ~ '^[0-9A-HJKMNP-TV-Z]{12}$', 'invite: 12 Crockford characters');
select public.gym_invite_revoke((select id from public.gym_invite_list() where note = 'qa revoked'));
select pg_temp.ok((select status from public.gym_invite_list() where note = 'qa revoked') = 'revoked', 'invite: revoke shows as revoked');
select pg_temp.ok(not exists (select 1 from jsonb_each_text((select to_jsonb(l) from public.gym_invite_list() l where note = 'qa A')) e
                              where e.value ilike '%' || pg_temp.g('inv_a') || '%'), 'invite: list never returns the code');
select pg_temp.su();
update public.gym_invite set expires_at = now() - interval '1 minute' where code_hash = public.gym_code_hash(pg_temp.g('inv_x'));
select pg_temp.ok((select count(*) from public.gym_invite where code_hash in (pg_temp.g('inv_a'), pg_temp.g('inv_b'))) = 0, 'invite: only the hash is stored');

-- S7: the sign-up gate.
select pg_temp.ok(pg_temp.signup(pg_temp.g('a')::uuid, 'qa-a@example.invalid', null) is not null, 'S7 no invite: refused');
select pg_temp.ok(pg_temp.signup(pg_temp.g('a')::uuid, 'qa-a@example.invalid', 'AAAA-BBBB-CCCC') is not null, 'S7 wrong code: refused');
select pg_temp.ok(pg_temp.signup(pg_temp.g('a')::uuid, 'qa-a@example.invalid', pg_temp.g('inv_x')) is not null, 'S7 expired code: refused');
select pg_temp.ok(pg_temp.signup(pg_temp.g('a')::uuid, 'qa-a@example.invalid', pg_temp.g('inv_r')) is not null, 'S7 revoked code: refused');
select pg_temp.ok(pg_temp.signup(pg_temp.g('a')::uuid, 'qa-other@example.invalid', pg_temp.g('inv_a')) is not null, 'S7 invite for another email: refused');
select pg_temp.ok(not exists (select 1 from auth.users where id = pg_temp.g('a')::uuid), 'S7 refused sign-ups create no user');
select pg_temp.ok((select used_at is null from public.gym_invite where code_hash = public.gym_code_hash(pg_temp.g('inv_a'))), 'S7 refused sign-ups do not use the code');
select pg_temp.ok(pg_temp.signup(pg_temp.g('a')::uuid, 'qa-a@example.invalid',
  lower(substr(pg_temp.g('inv_a'), 1, 4) || '-' || substr(pg_temp.g('inv_a'), 5, 4) || ' ' || substr(pg_temp.g('inv_a'), 9))) is null,
  'S7 lower-case, hyphenated valid code: accepted');
select pg_temp.ok(pg_temp.signup(gen_random_uuid(), 'qa-c@example.invalid', pg_temp.g('inv_a')) is not null, 'S7 used code: refused');
select pg_temp.ok(pg_temp.signup(pg_temp.g('b')::uuid, 'qa-b@example.invalid', pg_temp.g('inv_b')) is null, 'S7 open invite (no email): accepted');
select pg_temp.ok((select used_by from public.gym_invite where code_hash = public.gym_code_hash(pg_temp.g('inv_a'))) = pg_temp.g('a')::uuid, 'S7 used_by is the new user');
-- S9
select pg_temp.ok((select not (coalesce(raw_user_meta_data, '{}') ? 'invite') from auth.users where id = pg_temp.g('a')::uuid), 'S9 invite stripped from metadata');

-- S4: each user reaches only their own row.
select pg_temp.act(pg_temp.g('a')::uuid);
select public.gym_put('{"workouts":[{"id":"qa-a"}]}', null);
select pg_temp.ok(public.gym_get() -> 'workouts' -> 0 ->> 'id' = 'qa-a', 'S4 A reads her own row');
select pg_temp.act(pg_temp.g('b')::uuid);
select pg_temp.ok(public.gym_get() is null, 'S4 B (no row yet) reads nothing');
select pg_temp.ok(pg_temp.err($q$select public.gym_put('{"workouts":[]}', null)$q$) is null, 'S4 B writes his own row');
select pg_temp.ok(public.gym_get() -> 'workouts' = '[]', 'S4 B reads his own row');
select pg_temp.su();
select pg_temp.ok((select state -> 'workouts' -> 0 ->> 'id' from public.gym_state where user_id = pg_temp.g('a')::uuid) = 'qa-a', 'S4 A untouched by B');

-- S2: tables closed to anon and to B.
create function pg_temp.closed(t text) returns boolean language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I', t) into n;
  return n = 0;
exception when insufficient_privilege then return true;
end $$;
select pg_temp.act(null);
select pg_temp.ok(pg_temp.closed(t), 'S2 anon cannot read ' || t)
from unnest(array['gym_state', 'gym_history', 'gym_invite', 'gym_admin', 'gym_setup_code', 'push_sub', 'push_job', 'push_mark', 'push_vapid', 'gym_push_secret']) t;
select pg_temp.act(pg_temp.g('b')::uuid);
select pg_temp.ok(pg_temp.closed(t), 'S2 B cannot read ' || t)
from unnest(array['gym_state', 'gym_history', 'gym_invite', 'gym_admin', 'gym_setup_code', 'push_sub', 'push_job', 'push_mark', 'push_vapid', 'gym_push_secret']) t;

-- S3: admin RPCs refuse a member, anon and a connected AI app.
select pg_temp.ok(not public.gym_is_admin(), 'S3 B is not admin');
select pg_temp.ok(pg_temp.err(q) is not null, 'S3 B refused: ' || q)
from unnest(array['select public.gym_invite_mint(''x'', null)', 'select * from public.gym_invite_list()',
  'select public.gym_invite_revoke(gen_random_uuid())', 'select * from public.gym_admin_users()',
  format('select public.gym_reset_mint(%L)', pg_temp.g('a'))]) q;
select pg_temp.act(null);
select pg_temp.ok(pg_temp.err(q) is not null, 'S3 anon refused: ' || q)
from unnest(array['select public.gym_is_admin()', 'select public.gym_invite_mint(''x'', null)', 'select * from public.gym_admin_users()']) q;
select pg_temp.act(pg_temp.g('shoham')::uuid, '{"client_id":"qa-ai-app"}');
select pg_temp.ok(pg_temp.err('select public.gym_invite_mint(''x'', null)') is not null, 'S3 AI-app token refused even for the admin');

-- Member list: emails only.
select pg_temp.act(pg_temp.g('shoham')::uuid);
select pg_temp.ok((select array_agg(k order by k) from public.gym_admin_users() u, jsonb_object_keys(to_jsonb(u)) k
  where u.user_id = pg_temp.g('shoham')::uuid) = array['email', 'user_id'], 'admin: member list has user_id and email only');

-- S5: reset codes are per user.
select set_config('t.r1', public.gym_reset_mint(pg_temp.g('b')::uuid), true),
       set_config('t.r2', public.gym_reset_mint(pg_temp.g('b')::uuid), true),
       set_config('t.r3', public.gym_reset_mint(pg_temp.g('b')::uuid), true);
select pg_temp.su();
update public.gym_setup_code set expires_at = now() - interval '1 minute' where code_hash = public.gym_code_hash(pg_temp.g('r2'));
select set_config('t.a_pw', pg_temp.pw(pg_temp.g('a')::uuid), true), set_config('t.b_pw', pg_temp.pw(pg_temp.g('b')::uuid), true);
select set_config('t.revokes', (pg_get_functiondef('public.gym_set_password(text,text,text)'::regprocedure) ilike '%auth.sessions%')::text, true);
select pg_temp.err(format('insert into auth.sessions (id, user_id) values (gen_random_uuid(), %L)', pg_temp.g('b'))) where pg_temp.g('revokes') = 'true';
select pg_temp.act(null);
select set_config('t.e1', pg_temp.err(format('select public.gym_set_password(%L, %L, %L)', 'qa-a@example.invalid', pg_temp.g('r1'), 'qa-new-password-1')), true);
select pg_temp.ok(pg_temp.g('e1') <> '', 'S5 B''s code with A''s email: refused');
select pg_temp.ok(pg_temp.err(format('select public.gym_set_password(%L, %L, %L)', 'qa-b@example.invalid', pg_temp.g('r1'), 'short')) is not null, 'S5 password under 10 characters: refused');
select pg_temp.ok(pg_temp.err(format('select public.gym_set_password(%L, %L, %L)', 'QA-B@example.invalid', lower(pg_temp.g('r1')), 'qa-new-password-1')) is null, 'S5 B''s code with B''s email: accepted');
select set_config('t.e2', pg_temp.err(format('select public.gym_set_password(%L, %L, %L)', 'qa-b@example.invalid', pg_temp.g('r1'), 'qa-new-password-2')), true),
       set_config('t.e3', pg_temp.err(format('select public.gym_set_password(%L, %L, %L)', 'qa-b@example.invalid', pg_temp.g('r2'), 'qa-new-password-2')), true),
       set_config('t.e4', pg_temp.err(format('select public.gym_set_password(%L, %L, %L)', 'qa-b@example.invalid', 'WRONG-CODE-0000', 'qa-new-password-2')), true),
       set_config('t.e5', pg_temp.err(format('select public.gym_set_password(%L, %L, %L)', 'nobody@example.invalid', pg_temp.g('r3'), 'qa-new-password-2')), true);
select pg_temp.ok(pg_temp.g('e2') <> '', 'S5 used code: refused');
select pg_temp.ok(pg_temp.g('e3') <> '', 'S5 expired code: refused');
select pg_temp.ok(pg_temp.g('e1') = pg_temp.g('e2') and pg_temp.g('e2') = pg_temp.g('e3') and pg_temp.g('e3') = pg_temp.g('e4') and pg_temp.g('e4') = pg_temp.g('e5'),
  'S5 wrong email, used, expired, wrong code and unknown email give one error text');
-- S6 (QA C4): the old 2-argument function never takes a code minted for someone.
select pg_temp.ok(pg_temp.err(format('select public.gym_set_password(code => %L, pw => %L)', pg_temp.g('r3'), 'qa-takeover-pw')) is not null, 'S6 old 2-arg function refuses a member''s code');
select pg_temp.su();
select pg_temp.ok(pg_temp.pw(pg_temp.g('b')::uuid) <> pg_temp.g('b_pw'), 'S5 B''s password changed');
select pg_temp.ok(pg_temp.pw(pg_temp.g('a')::uuid) = pg_temp.g('a_pw'), 'S5 A''s password unchanged');
select pg_temp.ok(pg_temp.pw(pg_temp.g('shoham')::uuid) = pg_temp.g('s_pw'), 'S5/S6 Shoham''s password unchanged');
select pg_temp.ok(not exists (select 1 from auth.sessions where user_id = pg_temp.g('b')::uuid), 'S5 reset ended B''s sessions')
where pg_temp.g('revokes') = 'true';
select 'SKIP S5 session revoke: 20261023_zz_reset_ends_sessions.sql not applied' where pg_temp.g('revokes') <> 'true';

-- S11: B cannot take over A's push subscription or touch her jobs.
insert into public.push_sub (endpoint, user_id, keys) values ('https://push.invalid/qa-a', pg_temp.g('a')::uuid, '{"p256dh":"p","auth":"a"}');
insert into public.push_job (user_id, kind, fire_at) values (pg_temp.g('a')::uuid, 'rest', now() + interval '1 hour');
select pg_temp.act(pg_temp.g('b')::uuid);
select pg_temp.err($q$select public.push_subscribe('{"endpoint":"https://push.invalid/qa-a","keys":{"p256dh":"x","auth":"y"}}')$q$);
select pg_temp.err($q$select public.push_cancel('rest')$q$);
select pg_temp.su();
select pg_temp.ok((select user_id from public.push_sub where endpoint = 'https://push.invalid/qa-a') = pg_temp.g('a')::uuid, 'S11 B cannot take over A''s endpoint');
select pg_temp.ok((select sent_at is null from public.push_job where user_id = pg_temp.g('a')::uuid and kind = 'rest'), 'S11 B''s cancel leaves A''s job');

-- S12: the retired key functions error out for anon (decision 7: they stay).
select set_config('t.retired', (to_regprocedure('public.retired_key_gym_get(text)') is not null)::text, true);
select pg_temp.act(null);
select pg_temp.ok(pg_temp.err($q$select public.retired_key_gym_get('x')$q$) is not null, 'S12 retired_key_gym_get errors for anon')
where pg_temp.g('retired') = 'true';
select pg_temp.su();

-- S13: delete account (only once 20261023_zz_delete_account.sql is applied).
select set_config('t.del', (to_regprocedure('public.gym_delete_me()') is not null)::text, true);
select 'SKIP S13: 20261023_zz_delete_account.sql not applied' where pg_temp.g('del') <> 'true';
insert into public.push_sub (endpoint, user_id, keys) select 'https://push.invalid/qa-b', pg_temp.g('b')::uuid, '{"p256dh":"p","auth":"a"}' where pg_temp.g('del') = 'true';
select pg_temp.act(pg_temp.g('shoham')::uuid);
select pg_temp.ok(pg_temp.err('select public.gym_delete_me()') is not null, 'S13 the admin cannot delete himself from the app')
where pg_temp.g('del') = 'true';
select pg_temp.act(pg_temp.g('b')::uuid);
select pg_temp.ok(pg_temp.err('select public.gym_delete_me()') is null, 'S13 B deletes his account')
where pg_temp.g('del') = 'true';
select pg_temp.su();
select pg_temp.ok(not exists (select 1 from auth.users where id = pg_temp.g('b')::uuid)
              and not exists (select 1 from public.gym_state where user_id = pg_temp.g('b')::uuid)
              and not exists (select 1 from public.gym_history where user_id = pg_temp.g('b')::uuid)
              and not exists (select 1 from public.push_sub where user_id = pg_temp.g('b')::uuid), 'S13 B''s rows are gone')
where pg_temp.g('del') = 'true';
select pg_temp.ok(exists (select 1 from auth.users where id = pg_temp.g('a')::uuid)
              and exists (select 1 from public.push_sub where user_id = pg_temp.g('a')::uuid), 'S13 A untouched')
where pg_temp.g('del') = 'true';

-- Profile slot: object or null only.
select pg_temp.ok(pg_temp.err(format('update public.gym_state set state = state || %L where user_id = %L', '{"profile":{"name":"QA"}}', pg_temp.g('a'))) is null, 'shape: profile object accepted');
select pg_temp.ok(pg_temp.err(format('update public.gym_state set state = state || %L where user_id = %L', '{"profile":null}', pg_temp.g('a'))) is null, 'shape: profile null accepted');
select pg_temp.ok(pg_temp.err(format('update public.gym_state set state = state || %L where user_id = %L', '{"profile":"pregnant"}', pg_temp.g('a'))) is not null, 'shape: profile string refused');

-- S1: what anon (and PUBLIC) can execute in public.
select pg_temp.ok(not exists (
  select 1 from information_schema.routine_privileges
  where routine_schema = 'public' and grantee in ('anon', 'PUBLIC') and privilege_type = 'EXECUTE'
    and routine_name not in ('gym_set_password', 'retired_key_gym_get', 'retired_key_gym_put')), 'S1 anon can execute only gym_set_password (and the retired key functions)');
select format('S1 anon/PUBLIC can execute: %s', string_agg(distinct routine_name::text, ', '))
from information_schema.routine_privileges where routine_schema = 'public' and grantee in ('anon', 'PUBLIC') and privilege_type = 'EXECUTE';

-- S0 again: Shoham unchanged.
select pg_temp.ok(coalesce((select md5(state::text) from public.gym_state where user_id = pg_temp.g('shoham')::uuid), 'none') = pg_temp.g('s_state'), 'S0 Shoham''s state unchanged');
select pg_temp.ok(pg_temp.pw(pg_temp.g('shoham')::uuid) = pg_temp.g('s_pw'), 'S0 Shoham''s password unchanged');
select pg_temp.ok((select count(*)::text from public.push_sub where user_id = pg_temp.g('shoham')::uuid) = pg_temp.g('s_push'), 'S0 Shoham''s push subscriptions unchanged');

-- The SQL editor shows only this last result, so it names the failures.
select coalesce(nullif(pg_temp.g('fail'), ''), '0') || ' check(s) failed' as result, nullif(pg_temp.g('failed'), '') as failed;
rollback;
