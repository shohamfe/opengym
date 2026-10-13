import { it, expect, vi } from 'vitest'

// Fake browser + fake PostgREST: gym_get/gym_put accept only key 'k1', like the real functions.
const store = {}
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v) }, removeItem: k => { delete store[k] } }
globalThis.location = { search: '?key=k1&tab=2', pathname: '/home', hash: '' }
globalThis.history = { replaceState: vi.fn() }
let saved = null
globalThis.fetch = vi.fn(async (url, o) => {
  const { k, s } = JSON.parse(o.body)
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body })
  if (k !== 'k1') return res(403, { code: '28000', message: 'bad key' })
  if (url.endsWith('/gym_put')) { saved = s; return res(204, null) }
  return res(200, saved)
})

it('signs in from the link, syncs state, and drops a bad key', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co')
  vi.stubEnv('VITE_SUPABASE_KEY', 'pub')
  const { SUPABASE, supabaseApi: api } = await import('./supabaseSync.js')
  expect(SUPABASE).toBe(true)
  expect(store.gym_sync_key).toBe('k1')
  expect(history.replaceState).toHaveBeenCalledWith(null, '', '/home?tab=2')

  expect((await api('/api/me')).user.id).toBe('owner')
  expect(await api('/api/data')).toEqual({ state: null })
  await api('/api/data', { method: 'PUT', body: JSON.stringify({ state: { _ts: 5, routines: [1] } }) })
  expect(await api('/api/data')).toEqual({ state: { _ts: 5, routines: [1] } })
  expect(fetch.mock.calls[0][1].headers.apikey).toBe('pub')

  store.gym_sync_key = 'stale'
  await expect(api('/api/me')).rejects.toMatchObject({ status: 401 })
  expect(store.gym_sync_key).toBeUndefined()   // so the app falls back to the sign-in screen
  await expect(api('/api/me')).rejects.toMatchObject({ status: 401 })
  await expect(api('/api/register/options', { method: 'POST' })).rejects.toMatchObject({ status: 404 })
})
