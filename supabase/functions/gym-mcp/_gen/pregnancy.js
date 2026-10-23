// Stand-in for frontend/src/lib/pregnancy.js (same exports, same rules), used until that file is
// on the branch. scripts/build-mcp-data.mjs overwrites this with the app's copy once it exists, so
// the app and the AI always share one label function.
// shortcut: hand-written twin of lib/pregnancy.js, re-run the script as soon as that file lands.
import { PREG, RULES, NC_REASON } from './pregnancy-labels.js'

// Calendar day number (never new Date('YYYY-MM-DD'), which is UTC midnight, not local).
const dayNo = (y, m, d) => Date.UTC(y, m - 1, d) / 864e5

export function pregOf(S, now = Date.now()) {
  const p = S?.profile
  const due = p?.preg?.due
  if (p?.sex !== 'female' || !/^\d{4}-\d{2}-\d{2}$/.test(due || '')) return null
  const [y, m, d] = due.split('-').map(Number)
  const t = new Date(now)
  const gd = 280 - (dayNo(y, m, d) - dayNo(t.getFullYear(), t.getMonth() + 1, t.getDate()))
  if (gd < 0 || gd > 44 * 7) return null
  const week = Math.floor(gd / 7)
  return { week, day: gd % 7, tri: week < 14 ? 1 : week < 28 ? 2 : 3, due }
}

export const notConsistent = S => S?.profile?.exp !== 'regular'
export const gentle = S => !!pregOf(S) && S.profile.preg.clear !== 'yes'

const LABEL = { a: 'avoid', c: 'caution', r: 'rec', o: null }
function parts(id, S, now) {
  const p = pregOf(S, now)
  const e = p && PREG[id]
  if (!e) return null
  const [rule, t, u] = e.split(':')
  const nc = !!u && notConsistent(S)
  const ch = (nc ? u : t)[p.tri - 1]
  return { rule, ch, nc: nc && u[p.tri - 1] !== t[p.tri - 1] }
}

export const labelOf = (id, S, now) => LABEL[parts(id, S, now)?.ch] ?? null
export function reasonOf(id, S, now) {
  const x = parts(id, S, now)
  if (!x || !LABEL[x.ch]) return null
  return x.nc ? NC_REASON : RULES[x.rule] || null
}
