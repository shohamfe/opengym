import { setCookie } from '../_sync.js'

export default function handler(req, res) {
  res.setHeader('Set-Cookie', setCookie(''))
  res.json({ ok: true })
}
