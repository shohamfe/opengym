// kg ↔ lb for every stored load, so switching units changes the numbers and not just the label.
// Lifts snap to 0.5 in the new unit (a plate you can load); body weights and history keep 0.1.
// Untouched: reps, seconds, minutes, speed, effort, ids, dates.
export const KG_PER_LB = 0.45359237
const snap = (x, step) => Math.round(x / step) * step
const factor = (from, to) => (from === to ? 1 : to === 'lb' ? 1 / KG_PER_LB : KG_PER_LB)

// Mutates a draft (the store's update() hands one in) and returns it.
export function convertState(s, to) {
  const f = factor(s.unit || 'kg', to)
  s.unit = to
  if (f === 1) return s
  const fine = x => (typeof x === 'number' && x ? Math.round(snap(x * f, 0.1) * 10) / 10 : x)
  const lift = x => (typeof x === 'number' && x ? Math.max(0.5, snap(x * f, 0.5)) : x)
  const cfg = c => { if (!c) return; c.weight = lift(c.weight); c.inc = lift(c.inc) }
  const entry = (e, w) => { (e.sets || []).forEach(x => { x.w = w(x.w); (x.parts || []).forEach(p => { p.w = w(p.w) }) }); e.topW = lift(e.topW); cfg(e.target) }
  s.targetW = fine(s.targetW)
  ;(s.bodyweight || []).forEach(b => { b.w = fine(b.w) })
  ;(s.routines || []).forEach(r => (r.ex || []).forEach(cfg))
  Object.values(s.exWeights || {}).forEach(x => { x.w = lift(x.w) })
  ;(s.workouts || []).forEach(w => { w.bw = fine(w.bw); w.vol = typeof w.vol === 'number' ? Math.round(w.vol * f) : w.vol; (w.entries || []).forEach(e => entry(e, fine)) })
  if (s.active) { s.active.bw = fine(s.active.bw); s.active.entries.forEach(e => { entry(e, lift); delete e.plan }) }
  return s
}
