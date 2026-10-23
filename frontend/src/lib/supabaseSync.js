// Single-user cloud sync against Supabase, for a static deploy with no Node backend.
// Answers the few backend routes the store calls (/api/me, /api/data, /api/logout) with Supabase
// Auth (email + password, plain fetch against its REST API) and two database functions
// (gym_get / gym_put, see supabase/migrations). The session is kept in localStorage; the access
// token is refreshed on demand, so a phone that was closed for weeks just refreshes on open.
const URL_ = import.meta.env.VITE_SUPABASE_URL
const ANON = import.meta.env.VITE_SUPABASE_KEY
const SESSION = 'gym_session'
// The server _ts the device's copy is built on: set by the store when it takes the server copy,
// and here after each successful push. gym_put refuses (409) when the server moved on since.
export const BASE = 'gym_base'
// The auth user id the local state belongs to (see setUser in the store).
export const OWNER = 'gym_owner'
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

// status 0 = no network or no answer within 15 s (captive/bad gym Wi-Fi): the store treats
// anything but 401 as "offline, keep going locally".
async function call(path, body, token, method = 'POST') {
  const ctl = new AbortController()
  const tm = setTimeout(() => ctl.abort(), 15000)
  let r, data
  try {
    r = await fetch(`${URL_}${path}`, {
      method, signal: ctl.signal,
      headers: { apikey: ANON, 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
      ...(method === 'GET' || method === 'DELETE' ? {} : { body: JSON.stringify(body || {}) })
    })
    data = await r.json().catch(e => { if (e.name === 'AbortError') throw e; return null })
  } catch (e) { throw err(0, 'offline', 'offline') }
  finally { clearTimeout(tm) }
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

async function authed(path, args, method = 'POST', retry = true) {
  const s = await session()
  try { return await call(path, args, s.access_token, method) }
  catch (e) {
    if (e.status !== 401 || !retry) throw e
    // Token rejected before its stated expiry (clock skew, revoked): refresh once and retry, with
    // the newest refresh token — another call may have rotated it meanwhile (they are single use).
    const cur = load()
    if (!cur) throw err(401, 'not signed in')
    if (cur.access_token === s.access_token) await refresh(cur)
    return authed(path, args, method, false)
  }
}
const rpc = (fn, args) => authed(`/rest/v1/rpc/${fn}`, args)

// Connected AI apps: the MCP connector's address, and the Supabase OAuth 2.1 server's consent and
// grant endpoints (the REST calls behind supabase-js auth.oauth.*, read from @supabase/auth-js
// 2.118). The consent ones answer { redirect_url } once the user decided or already consented.
export const MCP_URL = URL_ ? URL_ + '/functions/v1/gym-mcp' : ''
const enc = encodeURIComponent
export const oauthDetails = id => authed(`/auth/v1/oauth/authorizations/${enc(id)}`, null, 'GET')
export const oauthDecide = (id, approve) => authed(`/auth/v1/oauth/authorizations/${enc(id)}/consent`, { action: approve ? 'approve' : 'deny' })
export const oauthGrants = () => authed('/auth/v1/user/oauth/grants', null, 'GET')
export const oauthRevoke = clientId => authed(`/auth/v1/user/oauth/grants?client_id=${enc(clientId)}`, null, 'DELETE')
export const signedInEmail = () => load()?.user?.email || null

const me = ({ user }) => ({ id: user.id, name: user.email, admin: false })

export const signIn = async (email, password) => me(save(await call('/auth/v1/token?grant_type=password', { email, password })))

// Sign-up with an invite code (the gate in supabase/migrations/20261023_accounts.sql checks and
// uses it). With "Confirm email" off the answer already holds a session.
export async function signUp(email, password, invite) {
  const d = await call('/auth/v1/signup', { email, password, data: { invite } })
  if (!d?.access_token) throw err(503, 'no session', 'no_session')
  return me(save(d))
}

// Forgotten password: a single-use reset code that the admin made for this account.
export async function resetPassword(email, code, password) {
  await call('/rest/v1/rpc/gym_set_password', { email, code, pw: password })
  return signIn(email, password)
}

// Admin card and account deletion: plain calls to the RPCs; each one checks the caller itself.
export const accountRpc = (fn, args) => rpc(fn, args)

export async function supabaseApi(path, opts = {}) {
  const method = opts.method || 'GET'
  if (path === '/api/me') return { user: me(await session()) }
  if (path === '/api/data' && method === 'GET') return { state: await rpc('gym_get') }
  if (path === '/api/data' && method === 'PUT') {
    const ts = await rpc('gym_put', { s: JSON.parse(opts.body).state, base: Number(localStorage.getItem(BASE)) || null })
    localStorage.setItem(BASE, ts)
    return { ok: true }
  }
  if (path === '/api/push/public-key') {
    const key = await rpc('push_public_key')
    if (!key) throw err(503, 'push not ready')
    return { key }
  }
  const body = () => JSON.parse(opts.body || '{}')
  if (path === '/api/push/subscribe') { await rpc('push_subscribe', { sub: body().subscription }); return { ok: true } }
  if (path === '/api/push/unsubscribe') { await rpc('push_unsubscribe', { endpoint: body().endpoint }); return { ok: true } }
  if (path === '/api/push/test') { await rpc('push_test'); return { ok: true } }
  const job = path.match(/^\/api\/push\/(rest-timer|stale)(\/cancel)?$/)
  if (job) {
    const kind = job[1] === 'stale' ? 'stale' : 'rest'
    if (job[2]) await rpc('push_cancel', { kind })
    else { const b = body(); await rpc('push_schedule', { kind, seconds: Math.round(+b.seconds || 0), title: b.title || null, body: b.body || null }) }
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
