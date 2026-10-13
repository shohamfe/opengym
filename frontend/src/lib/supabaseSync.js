// Single-user cloud sync against Supabase, for a static deploy with no Node backend.
// Answers the few backend routes the store calls (/api/me, /api/data, /api/logout) with Supabase
// Auth (an emailed one-time code, plain fetch against its REST API) and two database functions
// (gym_get / gym_put, see supabase/migrations). The session is kept in localStorage; the access
// token is refreshed on demand, so a phone that was closed for weeks just refreshes on open.
const URL_ = import.meta.env.VITE_SUPABASE_URL
const ANON = import.meta.env.VITE_SUPABASE_KEY
const SESSION = 'gym_session'
// The server _ts the device's copy is built on: set by the store when it takes the server copy,
// and here after each successful push. gym_put refuses (409) when the server moved on since.
export const BASE = 'gym_base'
export const SUPABASE = !!(URL_ && ANON) && import.meta.env.VITE_MOBILE !== '1' && import.meta.env.VITE_DEMO !== '1'

if (SUPABASE) localStorage.removeItem('gym_sync_key')   // left over from the old ?key= link sign-in

const err = (status, msg, code) => Object.assign(new Error(msg), { status, code })
const load = () => { try { return JSON.parse(localStorage.getItem(SESSION)) } catch { return null } }
const save = (d, prev) => {
  const s = {
    access_token: d.access_token, refresh_token: d.refresh_token,
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + d.expires_in,
    user: d.user ? { id: d.user.id, email: d.user.email } : prev.user
  }
  localStorage.setItem(SESSION, JSON.stringify(s))
  return s
}

// status 0 = no network: the store treats anything but 401 as "offline, keep going locally".
async function call(path, body, token) {
  let r
  try {
    r = await fetch(`${URL_}${path}`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
      body: JSON.stringify(body || {})
    })
  } catch (e) { throw err(0, 'offline', 'offline') }
  const data = await r.json().catch(() => null)
  if (r.ok) return data
  throw err(r.status, data?.msg || data?.message || data?.error_description || 'HTTP ' + r.status, data?.error_code || data?.code || data?.error)
}

let refreshing = null
function refresh(s) {
  // One refresh at a time: refresh tokens are single use.
  return refreshing ||= call('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token })
    .then(d => save(d, s), e => {
      // Only a rejected token means signed out; offline, 429 and 5xx keep the session.
      if ([400, 401, 403].includes(e.status)) { localStorage.removeItem(SESSION); throw err(401, 'not signed in') }
      throw e
    })
    .finally(() => { refreshing = null })
}

async function session() {
  const s = load()
  if (!s) throw err(401, 'not signed in')
  return s.expires_at - 60 > Date.now() / 1000 ? s : refresh(s)
}

async function rpc(fn, args, retry = true) {
  const s = await session()
  try { return await call(`/rest/v1/rpc/${fn}`, args, s.access_token) }
  catch (e) {
    // Token rejected before its stated expiry (clock skew, revoked): refresh once and retry.
    if (e.status === 401 && retry) { await refresh(s); return rpc(fn, args, false) }
    throw e
  }
}

export const sendCode = email => call('/auth/v1/otp', { email, create_user: true })

export async function verifyCode(email, token) {
  const { user } = save(await call('/auth/v1/verify', { type: 'email', email, token }))
  return { id: user.id, name: user.email, admin: false }
}

export async function supabaseApi(path, opts = {}) {
  const method = opts.method || 'GET'
  if (path === '/api/me') { const { user } = await session(); return { user: { id: user.id, name: user.email, admin: false } } }
  if (path === '/api/data' && method === 'GET') return { state: await rpc('gym_get') }
  if (path === '/api/data' && method === 'PUT') {
    const ts = await rpc('gym_put', { s: JSON.parse(opts.body).state, base: Number(localStorage.getItem(BASE)) || null })
    localStorage.setItem(BASE, ts)
    return { ok: true }
  }
  if (path.startsWith('/api/logout')) {
    const s = load()
    localStorage.removeItem(SESSION)
    localStorage.removeItem(BASE)
    // Best effort: the local session is gone either way.
    if (s) await call('/auth/v1/logout?scope=' + (path === '/api/logout/all' ? 'global' : 'local'), null, s.access_token).catch(() => {})
    return { ok: true }
  }
  throw err(404, 'not available in this deployment')
}
