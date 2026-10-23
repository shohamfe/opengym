import { it, expect, vi, beforeAll, beforeEach } from 'vitest'

// QA: the store's sync paths (pullState / pushState / signOut) against the real supabaseSync.js
// and a fake Supabase that behaves like supabase/migrations/20261013_email_auth.sql (server
// stamps _ts, gym_put answers 409 when base is not the current _ts, the refresh token can be
// revoked).
const ls = {}
globalThis.localStorage = { getItem: k => ls[k] ?? null, setItem: (k, v) => { ls[k] = String(v) }, removeItem: k => { delete ls[k] } }
globalThis.document = { visibilityState: 'visible', addEventListener: () => {} }

let row, clock, revoked, puts
const res = (status, body) => ({ ok: status < 300, status, json: async () => body })
globalThis.fetch = vi.fn(async (url, o) => {
  const b = JSON.parse(o.body)
  if (url.includes('grant_type=refresh_token')) return revoked ? res(400, { error_code: 'refresh_token_not_found' })
    : res(200, { access_token: 'a2', refresh_token: 'r2', expires_in: 3600, user: { id: 'u1', email: 'me@x.io' } })
  if (url.includes('/auth/v1/logout')) return res(204, null)
  if (revoked) return res(401, { code: 'PGRST303', message: 'JWT expired' })
  if (url.endsWith('/gym_get')) return res(200, row)
  if (url.endsWith('/gym_put')) {
    puts++
    if (row && row._ts !== b.base) return res(409, { code: 'PT409' })
    row = { ...b.s, _ts: ++clock }; delete row.active; return res(200, clock)
  }
  return res(404, {})
})

let useStore
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co')
  vi.stubEnv('VITE_SUPABASE_KEY', 'pub')
  ;({ useStore } = await import('./useStore.js'))
})
const signedIn = () => {
  ls.gym_session = JSON.stringify({ access_token: 'a1', refresh_token: 'r1', expires_at: Date.now() / 1000 + 3600, user: { id: 'u1', email: 'me@x.io' } })
  useStore.getState().setUser({ id: 'u1', name: 'me@x.io', admin: false })
}
beforeEach(() => {
  for (const k in ls) delete ls[k]
  row = null; clock = Date.now(); revoked = false; puts = 0
  useStore.setState({ user: null })
})

// New phone (or "Continue without account"), workouts logged as a guest, then "Sign in with
// email" while the cloud already holds data. The guest copy is NEWER than the cloud copy, so by
// design.md it should upload. Instead: no gym_base on this device -> gym_put(base null) -> 409
// -> pullState(true) -> the guest workouts are overwritten locally and never reach the server.
it('keeps guest workouts that are newer than the cloud copy when signing in', async () => {
  row = { workouts: [{ id: 'cloud' }], _ts: clock - 60_000 }
  useStore.getState().replaceState({ ...useStore.getState().S, workouts: [{ id: 'guest' }] })   // stamped now: newer
  signedIn()
  await useStore.getState().pullState()   // what EmailSignInSheet's go() does after setUser
  const ids = [...useStore.getState().S.workouts, ...row.workouts].map(w => w.id)
  expect(ids).toContain('guest')
})

// The refresh token is revoked while the app is open (Supabase "sign out everywhere" from the
// dashboard, refresh-token reuse detection, user deleted). supabaseSync drops the session and
// answers 401, but the store keeps `user` set: every push fails and only marks gym_dirty
// ("Changes waiting to sync" forever), and Sign out refuses ("Couldn't sync, so you're still
// signed in") although the device is not signed in. Only a full app reload shows the login.
it('treats a 401 from a sync call as signed out (data kept), so the user can sign in again', async () => {
  row = { workouts: [], _ts: clock }
  signedIn()
  ls.gym_session = JSON.stringify({ ...JSON.parse(ls.gym_session), expires_at: 1 })   // needs a refresh
  revoked = true
  useStore.getState().update(s => { s.workouts = [{ id: 'w1' }] })
  await useStore.getState().pushState()
  expect(useStore.getState().S.workouts).toEqual([{ id: 'w1' }])   // data kept (passes today)
  expect(useStore.getState().user).toBeNull()                       // fails today: still "signed in"
})

// Every pull that takes the server copy re-stamps the local _ts (persist), so the next
// foreground pull sees "phone newer" and PUTs the whole, unchanged state back. Each return to
// the app alternates a full download and a full upload, and each upload bumps the server _ts.
it('does not upload an unchanged state on every other foreground pull', async () => {
  row = { workouts: [{ id: 'w1' }], _ts: clock - 60_000 }   // last written a minute ago
  useStore.setState({ S: { ...useStore.getState().S, workouts: [], routines: [], bodyweight: [] } })   // fresh device
  signedIn()
  await useStore.getState().pullState()   // boot: takes the server copy
  expect(puts).toBe(0)
  await useStore.getState().pullState()   // app comes back to the foreground, nothing changed
  expect(puts).toBe(0)
})

// Covers the critical sign-out path design.md asked for: offline at sign-out keeps everything.
it('refuses to sign out and keeps local data when the final push fails', async () => {
  row = { workouts: [], _ts: clock }
  signedIn()
  useStore.getState().update(s => { s.workouts = [{ id: 'w1' }] })
  fetch.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch') })
  await expect(useStore.getState().signOut()).rejects.toThrow()
  expect(useStore.getState().S.workouts).toEqual([{ id: 'w1' }])
  expect(useStore.getState().user).not.toBeNull()
  expect(ls.gym_session).toBeDefined()
})

// F1: a workout logged offline must survive a 409 caused by Claude's edit: the server's routines
// win, the workout is merged in and uploaded, and the pre-merge copy is kept in gym_backup_v1.
it('merges offline workouts into the server copy on a 409 and keeps a backup', async () => {
  row = { workouts: [{ id: 'w0', d: '2026-10-01' }], routines: [{ id: 'old' }], bodyweight: [{ d: '2026-10-01', w: 80 }], _ts: clock }
  signedIn()
  await useStore.getState().pullState()   // device in sync with the server
  useStore.getState().update(s => { s.workouts.push({ id: 'w1', d: '2026-10-12' }); s.bodyweight.push({ d: '2026-10-12', w: 79 }) })
  row = { ...row, routines: [{ id: 'claude' }], _ts: ++clock }   // Claude rewrites the plan meanwhile
  await useStore.getState().pushState()   // 409 -> merge -> push
  const S = useStore.getState().S
  expect(S.routines).toEqual([{ id: 'claude' }])
  expect(S.workouts.map(w => w.id)).toEqual(['w0', 'w1'])
  expect(S.bodyweight.map(b => b.d)).toEqual(['2026-10-01', '2026-10-12'])
  expect(row.workouts.map(w => w.id)).toEqual(['w0', 'w1'])   // uploaded
  expect(row.routines).toEqual([{ id: 'claude' }])
  expect(JSON.parse(ls.gym_backup_v1).routines).toEqual([{ id: 'old' }])
  expect(ls.gym_dirty).toBeUndefined()
})

// Onboarding gate (QA D6): S.profile is only trustworthy once the server copy has been read,
// otherwise a signed-in account on a new phone would be onboarded again.
it('marks the first sync, and keeps the server profile', async () => {
  row = { workouts: [], profile: { name: 'Dana', sex: 'female' }, _ts: clock }
  useStore.setState({ synced: false, S: { ...useStore.getState().S, _ts: 0, profile: null, workouts: [], routines: [], bodyweight: [] } })
  signedIn()
  expect(useStore.getState().synced).toBe(false)
  await useStore.getState().pullState()
  expect(useStore.getState().synced).toBe(true)
  expect(useStore.getState().S.profile.name).toBe('Dana')
  expect(useStore.getState().S.bodyPick).toBe(null)   // DEF overlay: Auto
  useStore.getState().setUser(null)
  expect(useStore.getState().synced).toBe(false)
})

// R2 (qa-plan.md): a shared phone. A's session dies (401 keeps her data on the device), then B
// signs in on the same phone. B's account must never receive A's data, and A's data must leave
// the device.
const sessionFor = id => { ls.gym_session = JSON.stringify({ access_token: 'a1', refresh_token: 'r1', expires_at: Date.now() / 1000 + 3600, user: { id, email: id + '@x.io' } }) }
const aLosesSession = async () => {
  row = { workouts: [], _ts: clock }
  signedIn()                                             // A = u1
  await useStore.getState().pullState()
  useStore.getState().update(s => { s.workouts = [{ id: 'a-workout', d: '2026-10-20' }]; s.profile = { preg: { due: '2027-03-01' } } })
  ls.gym_backup_v1 = '{"workouts":[{"id":"a-old"}]}'; ls.gym_unit_backup = '{}'
  ls.gym_session = JSON.stringify({ ...JSON.parse(ls.gym_session), expires_at: 1 })
  revoked = true
  await useStore.getState().pushState()                  // 401: signed out, data kept
  expect(useStore.getState().user).toBeNull()
  expect(useStore.getState().S.workouts).toHaveLength(1)
  revoked = false
}
const signInAs = async id => { sessionFor(id); useStore.getState().setUser({ id, name: id, admin: false }); await useStore.getState().pullState() }

it('does not upload the previous account’s data into a new account with no row', async () => {
  await aLosesSession()
  expect(useStore.getState().canGuest()).toBe(false)   // A's data is on the phone: no guest way in
  row = null; puts = 0
  sessionFor('u2')
  expect(useStore.getState().setUser({ id: 'u2', name: 'u2', admin: false })).toBe(true)   // A's unsynced edits went: say so
  expect(useStore.getState().synced).toBe(false)   // onboarding waits for B's own pull
  await useStore.getState().pullState()
  expect(puts).toBe(0)
  expect(row).toBeNull()
  expect(useStore.getState().S.workouts).toEqual([])
  expect(useStore.getState().S.profile ?? null).toBeNull()
  expect(ls.gym_owner).toBe('u2')
  for (const k of ['gym_backup_v1', 'gym_unit_backup', 'gym_base', 'gym_dirty']) expect(ls[k]).toBeUndefined()
})

it('does not merge the previous account’s workouts into an existing account', async () => {
  await aLosesSession()
  row = { workouts: [{ id: 'b-workout', d: '2026-10-01' }], _ts: ++clock }; puts = 0
  await signInAs('u2')
  expect(puts).toBe(0)
  expect(row.workouts).toEqual([{ id: 'b-workout', d: '2026-10-01' }])
  expect(useStore.getState().S.workouts).toEqual([{ id: 'b-workout', d: '2026-10-01' }])
  expect(ls.gym_backup_v1).toBeUndefined()
})

it('keeps and uploads the data when the same account signs back in after a 401', async () => {
  await aLosesSession()
  sessionFor('u1')
  expect(useStore.getState().setUser({ id: 'u1', name: 'u1', admin: false })).toBe(false)   // nothing lost
  await signInAs('u1')
  expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['a-workout'])
  expect(row.workouts.map(w => w.id)).toEqual(['a-workout'])
})

it('still moves true guest data into the account that signs in', async () => {
  useStore.getState().replaceState({ ...useStore.getState().S, workouts: [{ id: 'guest' }] })
  row = null
  await signInAs('u2')
  expect(row.workouts.map(w => w.id)).toEqual(['guest'])
  expect(ls.gym_owner).toBe('u2')
})

it('tags a legacy install (synced, untagged) with its signed-in account and keeps its unsynced work', async () => {
  row = { workouts: [], _ts: clock }
  useStore.getState().replaceState({ ...useStore.getState().S, workouts: [{ id: 'offline' }] })
  ls.gym_base = String(clock); ls.gym_dirty = '1'
  sessionFor('u1')
  await useStore.getState().boot()
  expect(ls.gym_owner).toBe('u1')
  expect(row.workouts.map(w => w.id)).toEqual(['offline'])
})

it('clears the owner tag and backups on sign-out', async () => {
  row = { workouts: [], _ts: clock }
  signedIn()
  await useStore.getState().pullState()
  ls.gym_backup_v1 = '{}'; ls.gym_unit_backup = '{}'
  expect(useStore.getState().canGuest()).toBe(false)
  await useStore.getState().signOut()
  for (const k of ['gym_owner', 'gym_backup_v1', 'gym_unit_backup', 'gym_base', 'gym_dirty']) expect(ls[k]).toBeUndefined()
  expect(useStore.getState().canGuest()).toBe(true)   // a clean phone offers guest mode again
})
