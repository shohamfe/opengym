import { describe, it, expect } from 'vitest'
import { convertState } from './units.js'

const base = () => ({
  unit: 'kg', targetW: 77, bodyweight: [{ d: '2026-10-01', w: 78.4 }],
  routines: [{ ex: [{ id: '1', reps: 8, weight: 100, inc: 2.5 }] }],
  exWeights: { 1: { w: 100, d: '2026-10-01' } },
  workouts: [{ bw: 78.4, vol: 800, entries: [{ id: '1', topW: 100, target: { weight: 100 }, sets: [{ w: 100, r: 8, rir: 2, done: true }] }] }],
  active: { bw: 78, entries: [{ id: '1', plan: { why: ['x'] }, target: { weight: 100 }, sets: [{ w: 100, r: 8 }] }] },
})

describe('convertState parts', () => {
  it('converts parts[].w like s.w and leaves partials', () => {
    const s = base()
    s.workouts[0].entries[0].sets[0] = { w: 100, r: 8, done: true, tech: 'drop', parts: [{ w: 80, r: 6 }], partials: 3 }
    s.active.entries[0].sets[0] = { w: 100, r: 8, tech: 'drop', parts: [{ w: 80, r: 6 }] }
    convertState(s, 'lb')
    expect(s.workouts[0].entries[0].sets[0].parts[0].w).toBe(176.4)   // 0.1 snap
    expect(s.workouts[0].entries[0].sets[0].partials).toBe(3)
    expect(s.active.entries[0].sets[0].parts[0].w).toBe(176.5)        // 0.5 snap
  })
})

describe('convertState', () => {
  it('converts every load to lb and leaves reps/effort alone', () => {
    const s = convertState(base(), 'lb')
    expect(s.unit).toBe('lb')
    expect(s.targetW).toBe(169.8)
    expect(s.bodyweight[0].w).toBe(172.8)
    expect(s.routines[0].ex[0]).toMatchObject({ weight: 220.5, inc: 5.5, reps: 8 })
    expect(s.exWeights[1].w).toBe(220.5)
    expect(s.workouts[0].entries[0].sets[0]).toMatchObject({ w: 220.5, r: 8, rir: 2 })
    expect(s.workouts[0].vol).toBe(1764)
    expect(s.active.entries[0].plan).toBeUndefined()
    expect(s.active.entries[0].sets[0].w).toBe(220.5)
  })
  it('is the identity for the same unit and survives missing fields', () => {
    expect(convertState(base(), 'kg')).toEqual(base())
    expect(() => convertState({ unit: 'kg', active: null }, 'lb')).not.toThrow()
  })
  it('round-trips within the rounding step', () => {
    const s = convertState(convertState(base(), 'lb'), 'kg')
    expect(Math.abs(s.bodyweight[0].w - 78.4)).toBeLessThanOrEqual(0.1)
    expect(Math.abs(s.routines[0].ex[0].weight - 100)).toBeLessThanOrEqual(0.5)
  })
})
