// @vitest-environment node
import assert from 'node:assert'
import { test } from 'vitest'
const A = './'
// GitHub contents API stand-in: 404 until first write, sha must match like the real one.
process.env.GITHUB_DATA_TOKEN = 't'
let file = null, sha = 0
globalThis.fetch = async (url, o = {}) => {
  const acc = o.headers.Accept
  const R = (status, body) => ({ ok: status < 300, status, text: async () => body, json: async () => JSON.parse(body) })
  if (url.endsWith('/sync-key.txt')) return R(200, 'k123\n')   // login key lives in the data repo
  if (!o.method) {
    if (file == null) return R(404, '{}')
    return acc.includes('raw') ? R(200, file) : R(200, JSON.stringify({ sha: 's' + sha }))
  }
  const b = JSON.parse(o.body)
  if ((file == null) !== (b.sha === undefined) || (b.sha && b.sha !== 's' + sha)) return R(409, 'conflict')
  file = Buffer.from(b.content, 'base64').toString(); sha++; return R(200, '{}')
}
const res = () => { const r = { h: {}, code: 200 }; r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); r.send = b => (r.body = b, r); r.setHeader = (k, v) => r.h[k] = v; r.redirect = (c, l) => (r.code = c, r.loc = l, r); return r }
const call = async (f, req) => { const r = res(); await (await import(A + f)).default({ headers: {}, query: {}, ...req }, r); return r }
test('login, auth and GitHub-backed state round trip', async () => {
  const ck = { cookie: 'x=1; gym_sync=k123' }
  assert.equal((await call('me.js', {})).code, 401)
  assert.equal((await call('login.js', { query: { key: 'nope' } })).code, 403)
  const l = await call('login.js', { query: { key: 'k123' } }); assert.equal(l.code, 302); assert.match(l.h['Set-Cookie'], /gym_sync=k123; .*HttpOnly/)
  assert.equal((await call('me.js', { headers: ck })).body.user.id, 'owner')
  assert.equal((await call('data.js', { headers: ck, method: 'GET' })).body.state, null)
  assert.equal((await call('data.js', { headers: ck, method: 'PUT', body: {} })).code, 400)
  await call('data.js', { headers: ck, method: 'PUT', body: { state: { _ts: 1, routines: [1], active: { x: 1 } } } })
  await call('data.js', { headers: ck, method: 'PUT', body: { state: { _ts: 2, routines: [2] } } })
  assert.deepEqual((await call('data.js', { headers: ck, method: 'GET' })).body.state, { _ts: 2, routines: [2] })
  assert.equal((await call('data.js', { headers: { cookie: 'gym_sync=bad' }, method: 'GET' })).code, 401)
  assert.match((await call('logout/all.js', {})).h['Set-Cookie'], /Max-Age=0/)
})
