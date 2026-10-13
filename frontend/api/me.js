import { authed, USER } from './_sync.js'

export default function handler(req, res) {
  if (!authed(req)) return res.status(401).json({ error: 'not signed in' })
  res.json({ user: USER })
}
