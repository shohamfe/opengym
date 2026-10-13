import { it, expect, vi } from 'vitest'

// Fake browser + fake Supabase (Auth + PostgREST). Tokens: 'a1' is issued by /verify, 'a2' by a
// refresh; 'r1' is the only valid refresh token. gym_put behaves like the SQL: server stamps _ts
// and answers 409 when base is not the current _ts.
const store = { gym_sync_key: 'old' }
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v) }, removeItem: k => { delete store[k] } }
let row = null, clock = 1000, valid = new Set(), down = false
const res = (status, body) => ({ ok: status < 300, status, json: async () => body })
const tokens = (a, exp) => ({ access_token: a, refresh_token: 'r1', expires_in: 3600, expires_at: exp, user: { id: 'u1', email: 'me@x.io' } })
globalThis.fetch = vi.fn(async (url, o) => {
  if (down) throw new TypeError('Failed to fetch')
  const b = JSON.parse(o.body), bearer = o.headers.Authorization?.slice(7)
  if (url.endsWith('/auth/v1/otp')) return b.email === 'me@x.io' ? res(200, {}) : res(500, { msg: 'Database error saving new user' })
  if (url.endsWith('/auth/v1/verify')) {
    if (b.token !== '123456') return res(403, { error_code: 'otp_expired', msg: 'Token has expired or is invalid' })
    valid.add('a1'); return res(200, tokens('a1', Math.floor(Date.now() / 1000) + 3600))
  }
  if (url.includes('grant_type=refresh_token')) {
    if (b.refresh_token !== 'r1') return res(400, { error_code: 'refresh_token_not_found' })
    valid.add('a2'); return res(200, tokens('a2', Math.floor(Date.now() / 1000) + 3600))
  }
  if (url.includes('/auth/v1/logout')) { valid.delete(bearer); return res(204, null) }
  if (!valid.has(bearer)) return res(401, { code: 'PGRST303', message: 'JWT expired' })
  if (url.endsWith('/gym_get')) return res(200, row)
  if (url.endsWith('/gym_put')) {
    if (row && row._ts !== b.base) return res(409, { code: 'PT409', message: 'state changed on the server' })
    row = { ...b.s, _ts: ++clock }; return res(200, clock)
  }
  return res(404, {})
})

it('signs in with an email code, syncs, refreshes, detects conflicts and signs out', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co')
  vi.stubEnv('VITE_SUPABASE_KEY', 'pub')
  const { SUPABASE, supabaseApi: api, sendCode, verifyCode, BASE } = await import('./supabaseSync.js')
  expect(SUPABASE).toBe(true)
  expect(store.gym_sync_key).toBeUndefined()   // old link key cleaned up

  // Signed out: the app shows the login screen.
  await expect(api('/api/me')).rejects.toMatchObject({ status: 401 })
  await expect(api('/api/data')).rejects.toMatchObject({ status: 401 })

  // Strangers are refused by the owner-only trigger (a 500 from Auth); wrong code is a 403.
  await expect(sendCode('evil@x.io')).rejects.toMatchObject({ status: 500, message: 'Database error saving new user' })
  await sendCode('me@x.io')
  await expect(verifyCode('me@x.io', '000000')).rejects.toMatchObject({ status: 403, code: 'otp_expired' })
  expect(await verifyCode('me@x.io', '123456')).toEqual({ id: 'u1', name: 'me@x.io', admin: false })
  expect((await api('/api/me')).user).toEqual({ id: 'u1', name: 'me@x.io', admin: false })

  // First push inserts (no row, no base); the next push builds on the returned _ts.
  expect(await api('/api/data')).toEqual({ state: null })
  await api('/api/data', { method: 'PUT', body: JSON.stringify({ state: { routines: [1] } }) })
  expect(store[BASE]).toBe('1001')
  await api('/api/data', { method: 'PUT', body: JSON.stringify({ state: { routines: [2] } }) })
  expect((await api('/api/data')).state).toEqual({ routines: [2], _ts: 1002 })
  const put = fetch.mock.calls.findLast(c => c[0].endsWith('/gym_put'))[1]
  expect(put.headers).toMatchObject({ apikey: 'pub', Authorization: 'Bearer a1' })

  // Someone else (Claude, via SQL) wrote: a push from the stale base is refused with 409.
  row = { routines: ['claude'], _ts: 5000 }
  await expect(api('/api/data', { method: 'PUT', body: JSON.stringify({ state: { routines: [3] } }) })).rejects.toMatchObject({ status: 409 })
  expect(row.routines).toEqual(['claude'])

  // Access token expired by the clock: refreshed before the call.
  store.gym_session = JSON.stringify({ ...JSON.parse(store.gym_session), expires_at: 1 })
  await api('/api/data')
  expect(JSON.parse(store.gym_session).access_token).toBe('a2')

  // Token rejected by the server before its stated expiry: one refresh and a retry.
  valid.delete('a2')
  expect((await api('/api/data')).state.routines).toEqual(['claude'])

  // Offline during a refresh: not a sign-out (status 0, session kept).
  store.gym_session = JSON.stringify({ ...JSON.parse(store.gym_session), expires_at: 1 })
  down = true
  await expect(api('/api/me')).rejects.toMatchObject({ status: 0 })
  expect(store.gym_session).toBeDefined()
  down = false

  // Refresh token rejected: session dropped, 401.
  store.gym_session = JSON.stringify({ ...JSON.parse(store.gym_session), refresh_token: 'bad' })
  await expect(api('/api/me')).rejects.toMatchObject({ status: 401 })
  expect(store.gym_session).toBeUndefined()

  // Logout clears the session and base, revoking the token locally.
  await verifyCode('me@x.io', '123456')
  expect(await api('/api/logout', { method: 'POST', body: '{}' })).toEqual({ ok: true })
  expect(fetch.mock.calls.at(-1)[0]).toBe('https://x.supabase.co/auth/v1/logout?scope=local')
  expect(store.gym_session).toBeUndefined()
  expect(store[BASE]).toBeUndefined()
  await expect(api('/api/me')).rejects.toMatchObject({ status: 401 })
  await expect(api('/api/register/options', { method: 'POST' })).rejects.toMatchObject({ status: 404 })
})
