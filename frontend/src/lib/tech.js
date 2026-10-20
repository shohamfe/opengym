// Special set techniques: the one place that decides what a tagged set counts as.
// A set stays `{w, r, done, ...}`; `tech`, `parts` (extra drops/mini-sets only) and `partials` are optional.
import { fmtNum } from './format.js'
import { t } from './i18n.js'

export const MAX_PARTS = 6
// n/d are English source strings: callers translate with techName()/techDesc().
export const TECH = {
  warmup: { b: 'W', n: 'Warm-up', d: 'A lighter set to prepare. Excluded from all stats.' },
  fail: { b: 'F', n: 'Failure', d: 'Taken to momentary failure. Counts as a hard set.' },
  backoff: { b: 'B', n: 'Back-off', d: 'Lighter set after the top set. Ignored by progression.' },
  drop: { b: 'D', n: 'Drop set', d: 'Cut the weight about 20% and keep going, no rest.' },
  myo: { b: 'M', n: 'Myo-reps', d: 'Activation set, then short mini-sets at the same weight.' },
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
// Progression ignores warm-ups and back-offs (done-agnostic: an unticked planned set is still a miss).
export const isProgSet = s => s.tech !== 'warmup' && s.tech !== 'backoff'
// Tonnage: main plus filled parts; partials are never weight-bearing.
export const setVolume = s => (isWork(s) ? (s.w || 0) * (s.r || 0) + partsOf(s).reduce((a, p) => a + (p.w || 0) * p.r, 0) : 0)

// Weight for the next part: drop = 0.8x the previous part snapped to 0.5, myo/rest-pause = unchanged.
export const nextPartW = (tech, prevW) => (tech === 'drop' && prevW > 0 ? Math.max(0.5, Math.round(prevW * 0.8 * 2) / 2) : prevW || 0)
export const nextPart = s => {
  const ps = s.parts || []
  return { w: nextPartW(s.tech, ps.length ? ps[ps.length - 1].w : s.w), r: 0 }
}

// Finish-time cleanup: strip unfilled parts (and the empty array) without touching other fields.
export function cleanSet(s) {
  if (!s.parts) return s
  const { parts, ...rest } = s
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
