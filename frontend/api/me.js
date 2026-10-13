import { authed, USER } from './_sync.js'

export default async function handler(req, res) {
  if (!(await authed(req))) return res.status(401).json({ error: 'not signed in' })
  res.json({ user: USER })
}
