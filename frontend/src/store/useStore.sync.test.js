import { it, expect, vi, beforeAll, beforeEach } from 'vitest'

// QA: the store's sync paths (pullState / pushState / signOut) against the real supabaseSync.js
// and a fake Supabase that behaves like supabase/migrations/20261013_email_auth.sql (server
// stamps _ts, gym_put answers 409 when base is not the current _ts, the refresh token can be
// revoked). `it.fails` marks a known bug: the test states the correct behaviour and is
// expected to fail today; when the bug is fixed vitest reports it, and `.fails` comes off.
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
it.fails('keeps guest workouts that are newer than the cloud copy when signing in', async () => {
  row = { workouts: [{ id: 'cloud' }], _ts: clock - 60_000 }
  useStore.getState().replaceState({ ...useStore.getState().S, workouts: [{ id: 'guest' }] })   // stamped now: newer
  signedIn()
  await useStore.getState().pullState()   // what EmailSignInSheet's verify() does after setUser
  const ids = [...useStore.getState().S.workouts, ...row.workouts].map(w => w.id)
  expect(ids).toContain('guest')
})

// The refresh token is revoked while the app is open (Supabase "sign out everywhere" from the
// dashboard, refresh-token reuse detection, user deleted). supabaseSync drops the session and
// answers 401, but the store keeps `user` set: every push fails and only marks gym_dirty
// ("Changes waiting to sync" forever), and Sign out refuses ("Couldn't sync, so you're still
// signed in") although the device is not signed in. Only a full app reload shows the login.
it.fails('treats a 401 from a sync call as signed out (data kept), so the user can sign in again', async () => {
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
it.fails('does not upload an unchanged state on every other foreground pull', async () => {
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
