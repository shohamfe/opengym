// Pure helpers for the features borrowed from GymMane: strength balance, month recap,
// days off, the "ready for a harder variation" hint and left/right reps.
import { estimate1RM } from './onerm.js'
import { isWork, setVolume } from './tech.js'
import { isoOf, weekKey } from './format.js'

/* ---------- strength balance ---------- */
// Classic proportions of the big lifts to the squat (the same ones GymMane and most coaches use).
export const BALANCE = [
  { key: 'squat', name: 'Squat', ratio: 1, ids: ['0043'] },
  { key: 'deadlift', name: 'Deadlift', ratio: 1.2, ids: ['0032', '0117'] },
  { key: 'bench', name: 'Bench press', ratio: 0.75, ids: ['0025'] },
  { key: 'row', name: 'Barbell row', ratio: 0.52, ids: ['0027', '3017'] },
  { key: 'press', name: 'Overhead press', ratio: 0.45, ids: ['1456', '1457', '0091'] },
]
const DAY = 864e5

// Best estimated 1RM per lift over the last `days`, scaled by its ratio so all five read on the
// squat's scale. A lift under 85% of the strongest is "behind"; `gap` is what it takes to catch up.
// Needs 3 of the 5 lifts, otherwise there is nothing to compare.
export function strengthBalance(S, now = Date.now(), days = 120) {
  const from = isoOf(new Date(now - days * DAY))
  const rows = BALANCE.map(l => {
    let best = 0
    S.workouts.forEach(w => {
      if (w.d < from) return
      w.entries.forEach(e => {
        if (!l.ids.includes(e.id)) return
        e.sets.forEach(s => { if (s.done && isWork(s)) best = Math.max(best, estimate1RM(s.w, s.r) || 0) })
      })
    })
    return { ...l, e1rm: best, score: best / l.ratio }
  }).filter(r => r.e1rm > 0)
  if (rows.length < 3) return null
  const top = Math.max(...rows.map(r => r.score))
  return rows.map(r => ({
    ...r,
    pct: Math.round(r.score / top * 100),
    behind: r.score < top * 0.85,
    gap: Math.round((top * r.ratio - r.e1rm) * 2) / 2,
  }))
}

/* ---------- month recap ---------- */
// ym = 'YYYY-MM'. Counts what was trained that month; prs counts load records set in it.
export function monthRecap(S, ym) {
  const ws = S.workouts.filter(w => w.d.startsWith(ym))
  let sets = 0, vol = 0, min = 0, prs = 0
  const exN = {}
  ws.forEach(w => {
    prs += (w.prs || []).length
    if (w.end && w.start) min += Math.round((w.end - w.start) / 60000)
    w.entries.forEach(e => e.sets.forEach(s => {
      if (!s.done || !isWork(s)) return
      sets++; vol += setVolume(s); exN[e.id] = (exN[e.id] || 0) + 1
    }))
  })
  const topEx = Object.entries(exN).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  return { n: ws.length, days: new Set(ws.map(w => w.d)).size, sets, vol: Math.round(vol), min, prs, topEx }
}

/* ---------- days off ---------- */
// A week with a day off in it (S.offDays, ISO dates; the day itself is planned as 'rest') neither
// breaks nor adds to the streak.
export function offWeeks(S) {
  return new Set((S.offDays || []).map(d => weekKey(d, S.weekStart)))
}

/* ---------- left / right ---------- */
// Per-side sets can log each side ({ lr: [left, right] }); progression then counts the weaker
// side twice, so a 12 / 8 set can't pass a 10-per-side target on the stronger arm's reps.
export const progReps = s => (Array.isArray(s.lr) ? 2 * Math.min(s.lr[0] || 0, s.lr[1] || 0) : s.r || 0)

/* ---------- harder variation ---------- */
// Bodyweight work with nothing added that hit `top` reps or more on every set, two sessions
// running: time to move to a harder version instead of adding more reps.
export const EASY_REPS = 15
export function readyForHarder(sessions, top = EASY_REPS) {
  const last2 = sessions.slice(-2)
  return last2.length === 2 && last2.every(s => s.mode === 'reps' && s.weight === 0 && s.reps.length > 0 && s.reps.every(r => r >= top))
}
