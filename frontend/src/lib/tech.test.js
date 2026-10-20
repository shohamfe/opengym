import { describe, it, expect } from 'vitest'
import { isWork, isProgSet, setVolume, partsOf, nextPart, cleanSet, withTech, techBadge } from './tech.js'
import { setLabel, workoutVolume, setsDone, lastEntryFor, bestWeightFor } from './history.js'
import { bestSetOf } from './onerm.js'
import { isHardSet } from './effort.js'
import { loadOfWorkouts } from './muscles.js'
import { EXDB } from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight').id
const set = (o = {}) => ({ w: 60, r: 10, done: true, ...o })
const wk = sets => ({ entries: [{ id: LIFT, sets }] })

describe('tech helpers', () => {
  it('isWork: done and not warm-up', () => {
    expect(isWork(set())).toBe(true)
    expect(isWork(set({ tech: 'warmup' }))).toBe(false)
    expect(isWork(set({ done: false }))).toBe(false)
    expect(isWork(set({ tech: 'backoff' }))).toBe(true)
    expect(isProgSet(set({ tech: 'backoff' }))).toBe(false)
  })
  it('setVolume: main plus filled parts, no partials, no warm-ups', () => {
    expect(setVolume(set())).toBe(600)
    expect(setVolume(set({ tech: 'drop', parts: [{ w: 48, r: 8 }, { w: 36, r: 0 }], partials: 5 }))).toBe(600 + 384)
    expect(setVolume(set({ tech: 'warmup' }))).toBe(0)
    expect(setVolume(set({ tech: 'fail', parts: [{ w: 48, r: 8 }] }))).toBe(600)   // parts only for drop/myo/rp
  })
  it('partsOf ignores unfilled parts', () => {
    expect(partsOf(set({ tech: 'rp', parts: [{ w: 60, r: 4 }, { w: 60, r: 0 }] }))).toEqual([{ w: 60, r: 4 }])
    expect(partsOf(set())).toEqual([])
  })
  it('nextPart prefill', () => {
    expect(nextPart(set({ tech: 'drop' }))).toEqual({ w: 48, r: 0 })
    expect(nextPart(set({ tech: 'drop', parts: [{ w: 48, r: 8 }] }))).toEqual({ w: 38.5, r: 0 })   // 38.4 -> 38.5
    expect(nextPart(set({ tech: 'myo', w: 20 }))).toEqual({ w: 20, r: 0 })
    expect(nextPart(set({ tech: 'rp', parts: [{ w: 60, r: 4 }] }))).toEqual({ w: 60, r: 0 })
  })
  it('cleanSet strips unfilled parts and leaves plain sets alone', () => {
    const plain = set()
    expect(cleanSet(plain)).toBe(plain)
    expect(cleanSet(set({ tech: 'drop', parts: [{ w: 48, r: 0 }] }))).toEqual(set({ tech: 'drop' }))
    expect(cleanSet(set({ tech: 'drop', parts: [{ w: 48, r: 8 }, { w: 1, r: 0 }] })).parts).toEqual([{ w: 48, r: 8 }])
  })
  it('techBadge', () => { expect(techBadge(set({ tech: 'rp' }))).toBe('R'); expect(techBadge(set())).toBe('') })
})

describe('labels', () => {
  it('drop chain, myo chain, partials, warm-up', () => {
    expect(setLabel(LIFT, set({ tech: 'drop', parts: [{ w: 48, r: 8 }, { w: 36, r: 7 }] }))).toBe('60×10 › 48×8 › 36×7')
    expect(setLabel(LIFT, set({ tech: 'myo', w: 20, r: 15, parts: [{ w: 20, r: 5 }, { w: 20, r: 4 }] }))).toBe('20×15 + 5 + 4')
    expect(setLabel(LIFT, set({ partials: 3 }))).toBe('60×10 +3p')
    expect(setLabel(LIFT, set({ tech: 'warmup' }))).toBe('W 60×10')
    expect(setLabel(LIFT, set())).toBe('60×10')
  })
})

describe('call sites', () => {
  const w = wk([set({ w: 20, r: 10, tech: 'warmup' }), set({ tech: 'drop', parts: [{ w: 48, r: 8 }] }), set({ done: false })])
  it('volume and set count', () => { expect(workoutVolume(w)).toBe(984); expect(setsDone(w)).toBe(1) })
  it('PR weight, e1RM ignore warm-ups and parts', () => {
    const S = { workouts: [w] }
    expect(bestWeightFor(S, LIFT)).toBe(60)
    expect(bestSetOf(w.entries[0])).toMatchObject({ w: 60, r: 10 })
    expect(bestSetOf(wk([set({ w: 200, r: 1, tech: 'warmup' })]).entries[0])).toBe(null)
  })
  it('lastEntryFor returns working sets and skips warm-up-only entries', () => {
    expect(lastEntryFor({ workouts: [w] }, LIFT).sets).toHaveLength(1)
    expect(lastEntryFor({ workouts: [wk([set({ tech: 'warmup' })])] }, LIFT)).toBe(null)
  })
  it('hard sets: fail tag counts without RIR; warm-up not counted in load', () => {
    expect(isHardSet(set({ tech: 'fail' }))).toBe(true)
    expect(isHardSet(set())).toBe(false)
    const load = loadOfWorkouts([w])
    const none = loadOfWorkouts([wk([set({ tech: 'warmup' })])])
    expect(Object.values(load).some(v => v > 0)).toBe(true)
    expect(Object.values(none).every(v => !v)).toBe(true)
  })
})

describe('nextPartW with no weight', () => {
  it('stays 0 instead of the 0.5 floor', () => {
    expect(nextPart({ tech: 'drop', w: 0 })).toEqual({ w: 0, r: 0 })
  })
})
