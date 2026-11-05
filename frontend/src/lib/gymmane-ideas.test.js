import { describe, it, expect, vi, afterEach } from 'vitest'
import { effectiveRoutineId, platesPerSide, lastEntryFor } from './history.js'
import { sessionsFor } from './progression.js'

afterEach(() => vi.useRealTimers())

// Thursday 2026-11-05; plan: Mon A, Wed B, Fri C
const base = () => ({
  weekStart: 1, rotate: true, dayPlan: {},
  week: { 1: 'A', 3: 'B', 5: 'C' },
  routines: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
  workouts: [],
})

describe('rotation', () => {
  it('a missed day moves the plan: Wed B missed after Mon A → Fri gets B', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T10:00:00'))
    const S = base(); S.workouts = [{ d: '2026-11-02', routineId: 'A', entries: [] }]
    expect(effectiveRoutineId(S, '2026-11-06')).toBe('B')   // Fri
    expect(effectiveRoutineId(S, '2026-11-09')).toBe('C')   // Mon
    expect(effectiveRoutineId(S, '2026-11-11')).toBe('A')   // Wed, wraps
    expect(effectiveRoutineId(S, '2026-11-05')).toBe(null)  // Thu is still a rest day
  })
  it('trained today: today keeps it, the next day moves on', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T10:00:00'))
    const S = base(); S.workouts = [{ d: '2026-11-06', routineId: 'B', entries: [] }]
    expect(effectiveRoutineId(S, '2026-11-06')).toBe('B')
    expect(effectiveRoutineId(S, '2026-11-09')).toBe('C')
  })
  it('off, no history, or a day override: the week plan as before', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T10:00:00'))
    const S = base()
    expect(effectiveRoutineId(S, '2026-11-06')).toBe('C')
    S.workouts = [{ d: '2026-11-02', routineId: 'A', entries: [] }]
    S.dayPlan['2026-11-06'] = 'A'
    expect(effectiveRoutineId(S, '2026-11-06')).toBe('A')
    S.rotate = false; delete S.dayPlan['2026-11-06']
    expect(effectiveRoutineId(S, '2026-11-06')).toBe('C')
  })
})

describe('platesPerSide', () => {
  it('kg and lb, heaviest first, with what no plate makes up', () => {
    expect(platesPerSide(100, 'kg')).toEqual({ plates: [25, 15], rest: 0 })
    expect(platesPerSide(62.5, 'kg')).toEqual({ plates: [20, 1.25], rest: 0 })
    expect(platesPerSide(21, 'kg')).toEqual({ plates: [], rest: 0.5 })
    expect(platesPerSide(225, 'lb')).toEqual({ plates: [45, 45], rest: 0 })
    expect(platesPerSide(20, 'kg')).toBe(null)
  })
})

describe('light session', () => {
  it('is skipped by progression and by the next prefill', () => {
    const e = w => ({ id: 'x', sets: [{ w, r: 5, done: true }], target: { reps: 5, sets: 1 } })
    const S = { workouts: [{ d: '2026-11-01', entries: [e(100)] }, { d: '2026-11-03', light: true, entries: [e(60)] }] }
    expect(sessionsFor(S, 'x').map(s => s.weight)).toEqual([100])
    expect(lastEntryFor(S, 'x').sets[0].w).toBe(100)
  })
})
