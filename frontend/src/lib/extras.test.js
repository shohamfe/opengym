import { describe, it, expect, vi, afterEach } from 'vitest'
import { strengthBalance, monthRecap, offWeeks, progReps, readyForHarder } from './extras.js'
import { streakWeeks, setLabel } from './history.js'
import { readSession } from './progression.js'

afterEach(() => vi.useRealTimers())
const W = (d, id, w, r, extra = {}) => ({ d, entries: [{ id, sets: [{ w, r, done: true }] }], ...extra })

describe('strengthBalance', () => {
  const now = new Date('2026-11-06T12:00:00').getTime()
  it('flags the lift far below its classic ratio, with the gap to catch up', () => {
    const S = { workouts: [W('2026-10-01', '0043', 100, 1), W('2026-10-02', '0032', 120, 1), W('2026-10-03', '0025', 50, 1)] }
    const r = strengthBalance(S, now)
    const bench = r.find(x => x.key === 'bench')
    expect(bench.behind).toBe(true)
    expect(bench.gap).toBe(25)        // 75% of a 100 squat = 75, has 50
    expect(r.find(x => x.key === 'squat').behind).toBe(false)
  })
  it('needs three lifts, and ignores sessions older than 4 months', () => {
    expect(strengthBalance({ workouts: [W('2026-10-01', '0043', 100, 1), W('2026-10-02', '0032', 120, 1)] }, now)).toBe(null)
    expect(strengthBalance({ workouts: [W('2026-01-01', '0043', 100, 1), W('2026-10-02', '0032', 120, 1), W('2026-10-03', '0025', 75, 1)] }, now)).toBe(null)
  })
})

describe('monthRecap', () => {
  it('counts only that month', () => {
    const S = { workouts: [W('2026-10-30', 'x', 50, 10, { prs: ['x'], start: 1000, end: 3601000 }), W('2026-11-01', 'x', 50, 10)] }
    expect(monthRecap(S, '2026-10')).toMatchObject({ n: 1, sets: 1, vol: 500, min: 60, prs: 1, topEx: 'x' })
  })
})

describe('days off keep the streak', () => {
  it('a week with a day off is skipped, not a break', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T10:00:00'))   // Fri; weeks start Mon
    const S = { weekStart: 1, workouts: [W('2026-10-20', 'x', 1, 1), W('2026-11-03', 'x', 1, 1)], offDays: ['2026-10-29'] }
    expect(streakWeeks(S)).toBe(2)
    expect(streakWeeks({ ...S, offDays: [] })).toBe(1)
    expect(offWeeks(S).size).toBe(1)
  })
})

describe('left / right', () => {
  it('progression counts the weaker side twice; labels show the split', () => {
    expect(progReps({ r: 20, lr: [12, 8] })).toBe(16)
    expect(progReps({ r: 20 })).toBe(20)
    const s = readSession({ id: 'x', sets: [{ w: 10, r: 20, lr: [12, 8], done: true }], target: { reps: 20, sets: 1 } })
    expect(s.ok).toBe(false)
    expect(setLabel('x', { w: 10, r: 20, lr: [12, 8] }, { id: 'x', mode: 'reps' })).toContain('(L12 R8)')
  })
})

describe('readyForHarder', () => {
  const s = reps => ({ mode: 'reps', weight: 0, reps })
  it('two bodyweight sessions with 15+ on every set', () => {
    expect(readyForHarder([s([15, 15]), s([16, 15])])).toBe(true)
    expect(readyForHarder([s([15, 14]), s([16, 15])])).toBe(false)
    expect(readyForHarder([s([16, 15])])).toBe(false)
    expect(readyForHarder([s([15]), { ...s([15]), weight: 10 }])).toBe(false)
  })
})
