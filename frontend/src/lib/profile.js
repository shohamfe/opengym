// The person behind the account (S.profile, set by onboarding — null until then).
// Shape (shared contract): { name, sex: 'female'|'male'|'na', heightCm, exp: 'regular'|'some'|'none'|null,
//   preg: null | { due: 'YYYY-MM-DD', clear: 'yes'|'limits'|'notyet', clearAt, twins }, at }
import { isoOf } from './format.js'

export const isFemale = S => S?.profile?.sex === 'female'

// Body diagram: an explicit pick wins; otherwise follow the profile; before onboarding the
// old S.body toggle still applies.
export const bodyOf = S => S.bodyPick ||
  (S.profile ? (isFemale(S) ? 'female' : 'male') : (S.body === 'female' ? 'female' : 'male'))

// Onboarding only once the server copy is known (a fresh phone must not re-onboard an account
// whose profile simply hasn't arrived yet), and only for a signed-in account.
export const needsOnboarding = ({ user, synced, S }) => !!user && !!synced && !S.profile

// Due-date math in local time: a date string is read at local noon, never as UTC midnight.
const DAY = 86400000
const noon = iso => new Date(iso + 'T12:00:00')
const plusDays = (now, n) => { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return isoOf(d) }
// QA C9: up to two weeks overdue, at most 40 weeks out.
export const dueRange = (now = Date.now()) => ({ min: plusDays(now, -14), max: plusDays(now, 280) })
export const dueValid = (iso, now = Date.now()) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return false
  const { min, max } = dueRange(now)
  return iso >= min && iso <= max
}
// "I'm 22 weeks" → due date; weeks clamp to 0..42 (42 = two weeks overdue).
export const dueFromWeeks = (w, now = Date.now()) => plusDays(now, (40 - Math.max(0, Math.min(42, Math.round(w || 0)))) * 7)
// Whole weeks pregnant on `now` (display only; lib/pregnancy.js pregOf owns the real thing).
export const weeksOf = (iso, now = Date.now()) => {
  const d = new Date(now); d.setHours(12, 0, 0, 0)
  return Math.floor((280 - Math.round((noon(iso) - d) / DAY)) / 7)
}

// Height: stored in cm, shown as ft/in when the unit is lb.
export const cmToFtIn = cm => { const i = Math.round(cm / 2.54); return [Math.floor(i / 12), i % 12] }
export const ftInToCm = (ft, inch) => Math.round(((ft || 0) * 12 + (inch || 0)) * 2.54)
