// Sends due Web Push jobs (see supabase/migrations/20261014_push.sql). pg_cron pokes it via pg_net
// only when a job is due. Deployed with verify_jwt = false: a poke carries no input and can only make
// this send jobs that are already due (claimed atomically, so never twice); every read and write
// goes through service-role-only functions with the key Supabase injects here. A poke must carry
// the x-gym-push-secret header that push_tick sends (20261023_accounts.sql); anything else gets a
// 401 before any work, so a loop of stranger POSTs cannot drive the database.
import webpush from 'npm:web-push@3.6.7'

const URL_ = Deno.env.get('SUPABASE_URL')!
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

async function rpc(fn: string, args = {}) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  })
  if (!r.ok) throw new Error(`${fn}: HTTP ${r.status} ${await r.text()}`)
  return r.status === 204 ? null : r.json()
}

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

// First run makes the VAPID keypair and keeps it in the database, so nobody has to paste a secret.
async function vapid() {
  let v = await rpc('push_vapid_get')
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
    const pub = b64u(new Uint8Array([4, ...unb64u(jwk.x!), ...unb64u(jwk.y!)]))
    v = await rpc('push_vapid_put', { pub, priv: jwk.d })
  }
  return v as { public_key: string, private_key: string }
}

// Read once per isolate through a service-role function, so there is no secret to paste anywhere.
let secret: Promise<string | null> | null = null

Deno.serve(async (req) => {
  secret ||= rpc('push_secret').catch(e => { secret = null; throw e })
  const want = await secret.catch(() => null)
  if (!want || req.headers.get('x-gym-push-secret') !== want) return new Response('unauthorized', { status: 401 })
  const out = { sent: 0, failed: 0, gone: 0, errors: [] as string[] }
  try {
    const v = await vapid()
    webpush.setVapidDetails('https://opengym-alpha-seven.vercel.app', v.public_key, v.private_key)
    const jobs = await rpc('push_claim')
    const gone: string[] = []
    await Promise.all(jobs.flatMap((j: any) => j.subs.map(async (sub: any) => {
      try {
        // urgency high: iOS/Android hold back low-urgency pushes on battery saving. A late "rest over" is noise.
        await webpush.sendNotification(sub, JSON.stringify(j.payload), { urgency: 'high', TTL: j.kind === 'rest' ? 300 : 3600 })
        out.sent++
      } catch (e: any) {
        out.failed++
        out.errors.push(`${j.kind} ${e.statusCode || ''} ${String(e.body || e.message).slice(0, 200)}`)
        if (e.statusCode === 404 || e.statusCode === 410) gone.push(sub.endpoint)
      }
    })))
    if (gone.length) { await rpc('push_gone', { endpoints: gone }); out.gone = gone.length }
  } catch (e: any) {
    out.errors.push(String(e.message || e))
    console.error('gym-push', out)
    return Response.json(out, { status: 500 })
  }
  if (out.errors.length) console.error('gym-push', out)
  return Response.json(out)
})
