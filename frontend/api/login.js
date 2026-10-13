import { keyOk, setCookie } from './_sync.js'

// Open /api/login?key=<SYNC_KEY> once on each device: sets the session cookie and goes home.
export default function handler(req, res) {
  if (!keyOk(req.query.key)) return res.status(403).send('Wrong or missing key.')
  res.setHeader('Set-Cookie', setCookie(req.query.key))
  res.redirect(302, '/')
}
