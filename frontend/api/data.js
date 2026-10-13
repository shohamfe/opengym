import { authed, readState, writeState } from './_sync.js'

export default async function handler(req, res) {
  if (!authed(req)) return res.status(401).json({ error: 'not signed in' })
  try {
    if (req.method === 'GET') return res.json({ state: await readState() })
    if (req.method !== 'PUT') return res.status(405).json({ error: 'method not allowed' })
    const state = req.body?.state
    if (!state || typeof state !== 'object' || Array.isArray(state)) return res.status(400).json({ error: 'state required' })
    delete state.active              // in-progress workouts stay device-local, as on the Node server
    await writeState(state)
    res.json({ ok: true, ts: state._ts || null })
  } catch (e) {
    console.error(e)
    res.status(502).json({ error: 'sync storage unavailable' })
  }
}
