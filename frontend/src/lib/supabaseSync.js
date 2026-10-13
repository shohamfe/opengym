// Single-user cloud sync against Supabase, for a static deploy with no Node backend.
// Answers the few backend routes the store calls (/api/me, /api/data, /api/logout) with two
// key-checked database functions (gym_get / gym_put, see supabase/migrations). The device is
// signed in by opening the app once with ?key=<sync key>; the key is then kept in localStorage.
const URL_ = import.meta.env.VITE_SUPABASE_URL
const ANON = import.meta.env.VITE_SUPABASE_KEY
const KEY = 'gym_sync_key'
export const SUPABASE = !!(URL_ && ANON) && import.meta.env.VITE_MOBILE !== '1' && import.meta.env.VITE_DEMO !== '1'

if (SUPABASE) {
  const q = new URLSearchParams(location.search)
  if (q.get('key')) {
    localStorage.setItem(KEY, q.get('key'))
    q.delete('key')
    history.replaceState(null, '', location.pathname + (q.size ? '?' + q : '') + location.hash)
  }
}

const err = (status, msg) => Object.assign(new Error(msg), { status })

async function rpc(fn, args) {
  const k = localStorage.getItem(KEY)
  if (!k) throw err(401, 'not signed in')
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ k, ...args })
  })
  const data = await r.json().catch(() => null)
  if (r.ok) return data
  // 28000 is the functions' "bad key"; PostgREST maps it to 401/403.
  if (data?.code === '28000') { localStorage.removeItem(KEY); throw err(401, 'not signed in') }
  throw err(r.status, data?.message || 'HTTP ' + r.status)
}

export async function supabaseApi(path, opts = {}) {
  const method = opts.method || 'GET'
  if (path === '/api/me') { await rpc('gym_get'); return { user: { id: 'owner', name: 'Me', admin: false } } }
  if (path === '/api/data' && method === 'GET') return { state: await rpc('gym_get') }
  if (path === '/api/data' && method === 'PUT') { await rpc('gym_put', { s: JSON.parse(opts.body).state }); return { ok: true } }
  if (path.startsWith('/api/logout')) { localStorage.removeItem(KEY); return { ok: true } }
  throw err(404, 'not available in this deployment')
}
