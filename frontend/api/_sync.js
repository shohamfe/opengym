// Single-user cloud sync for the Vercel deploy: the whole app state lives in one JSON file in a
// private GitHub repo (free, versioned, and reachable by AI tools that can edit GitHub).
// Env: GITHUB_DATA_TOKEN (fine-grained, Contents read/write on the data repo), optional
// GITHUB_DATA_REPO (owner/name) and GITHUB_DATA_PATH. The login secret is SYNC_KEY if set,
// otherwise sync-key.txt in the data repo, so setup needs only the one token.
import { timingSafeEqual } from 'node:crypto'

const REPO = process.env.GITHUB_DATA_REPO || 'shohamfe/opengym-data'
const FILE = process.env.GITHUB_DATA_PATH || 'state.json'
const BASE = `https://api.github.com/repos/${REPO}/contents/`
export const COOKIE = 'gym_sync'
export const USER = { id: 'owner', name: 'Me', admin: false }

let repoKey   // cached per warm instance; a rotated key takes effect on the next cold start

async function loginKey() {
  if (process.env.SYNC_KEY) return process.env.SYNC_KEY
  if (repoKey === undefined) {
    const r = await gh('sync-key.txt', 'application/vnd.github.raw+json')
    if (!r.ok && r.status !== 404) await fail(r)
    repoKey = r.ok ? (await r.text()).trim() : ''
  }
  return repoKey
}

export async function keyOk(k) {
  const want = await loginKey()
  if (!want || typeof k !== 'string') return false
  const a = Buffer.from(k), b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function authed(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))
  return !!m && keyOk(decodeURIComponent(m[1]))
}

export const setCookie = v =>
  `${COOKIE}=${encodeURIComponent(v)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${v ? 34560000 : 0}`

const gh = (file, accept, opts = {}) => fetch(BASE + file, {
  ...opts,
  headers: { Authorization: `Bearer ${process.env.GITHUB_DATA_TOKEN}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...opts.headers }
})

async function fail(r) {
  const e = new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`)
  e.status = r.status
  throw e
}

// Raw media type works past the contents API's 1 MB inline limit.
export async function readState() {
  const r = await gh(FILE, 'application/vnd.github.raw+json')
  if (r.status === 404) return null
  if (!r.ok) await fail(r)
  return JSON.parse(await r.text())
}

async function currentSha() {
  const r = await gh(FILE, 'application/vnd.github.object+json')
  if (r.status === 404) return undefined
  if (!r.ok) await fail(r)
  return (await r.json()).sha
}

export async function writeState(state) {
  const content = Buffer.from(JSON.stringify(state, null, 1)).toString('base64')
  // One retry: a 409/422 means another write landed between reading the sha and writing.
  for (let i = 0; ; i++) {
    const r = await gh(FILE, 'application/vnd.github+json', {
      method: 'PUT',
      body: JSON.stringify({ message: 'app sync', content, sha: await currentSha() })
    })
    if (r.ok) return
    if (i || (r.status !== 409 && r.status !== 422)) await fail(r)
  }
}
