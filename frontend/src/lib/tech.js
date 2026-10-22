// Special set techniques: the one place that decides what a tagged set counts as.
// A set stays `{w, r, done, ...}`; `tech`, `parts` (extra drops/mini-sets only) and `partials` are optional.
import { fmtNum } from './format.js'
import { t } from './i18n.js'

export const MAX_PARTS = 6
// n/d are English source strings: callers translate with techName()/techDesc().
export const TECH = {
  warmup: { b: 'W', n: 'Warm-up', d: 'Adds one lighter set first: about 80% for 5 reps. Excluded from all stats.' },
  fail: { b: 'F', n: 'Failure', d: 'Taken to momentary failure. Counts as a hard set.' },
  backoff: { b: 'B', n: 'Back-off', d: 'About 15% lighter than your top set. Ignored by progression.' },
  drop: { b: 'D', n: 'Drop set', d: 'Cut the weight about 20% and keep going, no rest.' },
  myo: { b: 'M', n: 'Myo-reps', d: 'Lighter activation set of 12-15, then mini-sets of 5 after 3-5 breaths. Stop when you can’t get 3.' },
  rp: { b: 'R', n: 'Rest-pause', d: 'Rest 10-20 s, then more reps at the same weight.' },
}
export const TECH_IDS = Object.keys(TECH)
export const PARTS_TECH = ['drop', 'myo', 'rp']
export const techName = id => t(TECH[id].n)
export const techDesc = id => t(TECH[id].d)
export const techBadge = s => (s && TECH[s.tech] ? TECH[s.tech].b : '')

// Filled parts only: a blank/0-rep part is an unfilled row and must not count anywhere.
export const partsOf = s => (s && PARTS_TECH.includes(s.tech) && s.parts ? s.parts.filter(p => p && p.r > 0) : [])
// Ticked and not a warm-up: the set counts for sets, PRs, e1RM, hard sets, muscle load.
export const isWork = s => !!s && !!s.done && s.tech !== 'warmup'
// Progression ignores warm-ups, back-offs and myo sets, all deliberately lighter than the plan
// (done-agnostic: an unticked planned set is still a miss).
export const isProgSet = s => s.tech !== 'warmup' && s.tech !== 'backoff' && s.tech !== 'myo'
// Tonnage: main plus filled parts; partials are never weight-bearing.
export const setVolume = s => (isWork(s) ? (s.w || 0) * (s.r || 0) + partsOf(s).reduce((a, p) => a + (p.w || 0) * p.r, 0) : 0)

// Round to a loadable multiple of the exercise's weight step.
export const snap = (v, step) => Math.round((step > 0 ? Math.round(v / step) * step : v) * 10) / 10
// pct of w on the step grid, but always at least one step lighter (a 10 kg stack with 5 kg steps
// can't "drop 20%" to 10) and never below one step.
export const lighter = (w, pct, step = 0.5) => {
  if (!(w > 0)) return 0
  let v = snap(w * pct, step)
  if (v >= w) v = snap(w - step, step)
  return Math.max(step, v)
}

// Weight for the next part: drop = 0.8x the previous part on the step grid, myo/rest-pause = unchanged.
export const nextPartW = (tech, prevW, step) => (tech === 'drop' ? lighter(prevW, 0.8, step) : prevW || 0)
// Reps for the next part, so every row arrives filled: after a ~20% drop you get about 80% of the
// reps (60x10 > 48x8), rest-pause about 40% of the first set then one fewer each (10 > 4 > 3), myo 5.
export const nextPartR = (tech, prevR, first) => (tech === 'myo' ? MYO_MINI
  : !(prevR > 0) ? 0
  : tech === 'drop' ? Math.max(1, Math.round(prevR * 0.8))
  : Math.max(2, first ? Math.round(prevR * 0.4) : prevR - 1))
export const nextPart = (s, step) => {
  const ps = s.parts || [], prev = ps.length ? ps[ps.length - 1] : s
  return { w: nextPartW(s.tech, prev.w, step), r: nextPartR(s.tech, prev.r, !ps.length) }
}

// Warm-up: one set before the first working set. A single heavier warm-up (~80% x 5) beat lighter,
// longer ones for the working sets after it (2024 cross-over study; Ribeiro et al.).
export const WARMUP_PCT = 0.8
export const warmupW = (workW, step) => (workW > 0 ? snap(workW * WARMUP_PCT, step) : 0)
export const warmupSet = (work, step) => ({
  w: warmupW(work.w, step),
  r: work.w > 0 ? 5 : Math.max(3, Math.round((work.r || 0) / 2)),   // bodyweight: half the reps
  done: false, tech: 'warmup'
})

// Back-off: ~85% of the top set (research: 10-20% lighter).
export const backoffW = (topW, step) => lighter(topW, 0.85, step)

// Myo-reps (Fagerli): activation set of 12-15 at about a 15-rep max, then mini-sets of 5 at the same
// weight. The 15RM comes from the set's own weight x reps through Epley: w·(1 + r/30)/(1 + 15/30).
export const MYO_REPS = 12, MYO_MINI = 5, MYO_SEED = 3, MYO_MAX = 5
export const maxParts = tech => (tech === 'myo' ? MYO_MAX : MAX_PARTS)
export const myoW = (w, r, step) => (w > 0 && r < MYO_REPS ? snap(w * (30 + r) / 45, step) : w || 0)

// Finish-time cleanup: strip unfilled parts (and the empty array) and the pre-conversion
// weight/reps that undo needs, without touching other fields.
export function cleanSet(s) {
  if (!s.parts && !s.pre) return s
  const { parts, pre, ...rest } = s
  const ps = partsOf(s)
  return ps.length ? { ...rest, parts: ps } : rest
}


// Wraps the already-formatted main part: `60×10 › 48×8`, myo/rp same weight `20×15 + 5 + 4`, `+3p`, `W ` prefix.
export function withTech(s, main) {
  const ps = partsOf(s)
  const same = ps.every(p => (p.w || 0) === (s.w || 0))
  const chain = ps.map(p => (same ? ` + ${p.r}` : ` › ${fmtNum(p.w || 0)}×${p.r}`)).join('')
  return (s.tech === 'warmup' ? 'W ' : '') + main + chain + (s.partials > 0 ? ` +${s.partials}p` : '')
}
