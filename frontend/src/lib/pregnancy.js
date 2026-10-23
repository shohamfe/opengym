// Pregnancy mode (coach-pregnancy.md, build-plan contract). Pure functions of S.
// No imports besides the labels: the MCP edge function (Deno) reuses this file as is.
// Reasons come back in English; the UI translates them with t().
import { PREG, RULES, NC_REASON } from './pregnancy-labels.js'

const DAY = 86400000
// 'YYYY-MM-DD' as local noon. new Date('YYYY-MM-DD') is UTC midnight, a day off west of UTC;
// noon keeps a DST hour from tipping the day count (Math.round absorbs it).
const localNoon = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  return m ? new Date(+m[1], m[2] - 1, +m[3], 12).getTime() : NaN
}
const todayNoon = now => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() }

/** null | { week, day, tri, due }. Weeks = 40 - days to due / 7 (ACOG). Past the due date it
 *  stays T3 until the user says the baby arrived; a due date over 40 weeks out counts as week 0. */
export function pregOf(S, now = Date.now()) {
  if (S?.profile?.sex !== 'female') return null
  const due = S.profile.preg?.due
  const dueMs = localNoon(due)
  if (Number.isNaN(dueMs)) return null
  const gd = Math.max(0, 280 - Math.round((dueMs - todayNoon(now)) / DAY))
  const week = Math.floor(gd / 7)
  return { week, day: gd % 7, tri: week < 14 ? 1 : week < 28 ? 2 : 3, due }
}

// Anything other than "regular strength training" before pregnancy (coach D).
export const notConsistent = S => S?.profile?.exp !== 'regular'

// Gentle mode: pregnant and not plainly cleared (coach B).
export const gentle = S => !!pregOf(S) && S.profile.preg.clear !== 'yes'

// Conception estimate = due - 280 days, as 'YYYY-MM-DD' (for the pre-pregnancy load cap).
export function conceptionISO(S) {
  const ms = localNoon(S?.profile?.preg?.due)
  if (Number.isNaN(ms)) return null
  const d = new Date(ms - 280 * DAY)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

const NAME = { a: 'avoid', c: 'caution', r: 'rec' }
function lookup(id, S, now) {
  const p = pregOf(S, now)
  const e = p && PREG[id]
  if (!e) return null
  const [rule, t, tu] = e.split(':')
  const own = t[p.tri - 1]
  const ch = (notConsistent(S) && tu) ? tu[p.tri - 1] : own
  return NAME[ch] ? { label: NAME[ch], rule, nc: ch !== own } : null
}

/** 'avoid' | 'caution' | 'rec' | null (no badge). */
export const labelOf = (id, S, now) => lookup(id, S, now)?.label || null

/** One-sentence English reason for the badge, or null. */
export function reasonOf(id, S, now) {
  const l = lookup(id, S, now)
  if (!l) return null
  if (l.nc) return NC_REASON
  // A few entries are Good pick in T1 and Take care later; their main rule is the later one.
  return l.label === 'rec' ? RULES.recommended : RULES[l.rule]
}
