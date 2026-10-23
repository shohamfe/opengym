import { it, expect, describe } from 'vitest'
import { isFemale, bodyOf, needsOnboarding, dueRange, dueValid, dueFromWeeks, weeksOf, cmToFtIn, ftInToCm } from './profile.js'
import { EXDB, EXIDX, FEMALE_OF, mediaOf } from './exercises.js'

const F = { profile: { sex: 'female' } }
const M = { profile: { sex: 'male' } }
const NOW = new Date(2026, 9, 23, 9, 0).getTime()   // 23 Oct 2026, local time

describe('profile', () => {
  it('isFemale only for sex female', () => {
    expect(isFemale(F)).toBe(true)
    expect(isFemale(M)).toBe(false)
    expect(isFemale({ profile: { sex: 'na' } })).toBe(false)
    expect(isFemale({ profile: null })).toBe(false)
    expect(isFemale(null)).toBe(false)
  })
  it('bodyOf: explicit pick wins, then the profile, then the old toggle', () => {
    expect(bodyOf({ ...F, bodyPick: null, body: 'male' })).toBe('female')       // Auto follows profile (QA D2)
    expect(bodyOf({ ...F, bodyPick: 'male', body: 'male' })).toBe('male')
    expect(bodyOf({ ...M, bodyPick: 'female' })).toBe('female')
    expect(bodyOf({ profile: { sex: 'na' }, bodyPick: null, body: 'female' })).toBe('male')
    expect(bodyOf({ profile: null, bodyPick: null, body: 'female' })).toBe('female')
    expect(bodyOf({ profile: null, bodyPick: null, body: 'male' })).toBe('male')
  })
  it('onboarding waits for the first sync and a missing profile', () => {
    const u = { id: 'u1' }
    expect(needsOnboarding({ user: u, synced: false, S: { profile: null } })).toBe(false)
    expect(needsOnboarding({ user: null, synced: true, S: { profile: null } })).toBe(false)
    expect(needsOnboarding({ user: u, synced: true, S: { profile: { name: 'a' } } })).toBe(false)
    expect(needsOnboarding({ user: u, synced: true, S: { profile: null } })).toBe(true)
  })
})

describe('due date', () => {
  it('range is two weeks overdue to 40 weeks out', () => {
    expect(dueRange(NOW)).toEqual({ min: '2026-10-09', max: '2027-07-30' })
    expect(dueValid('2026-10-09', NOW)).toBe(true)    // overdue is allowed
    expect(dueValid('2026-10-08', NOW)).toBe(false)
    expect(dueValid('2027-07-30', NOW)).toBe(true)
    expect(dueValid('2027-07-31', NOW)).toBe(false)
    expect(dueValid('', NOW)).toBe(false)
    expect(dueValid('2027-3-1', NOW)).toBe(false)
  })
  it('weeks pregnant round-trips and clamps', () => {
    expect(dueFromWeeks(40, NOW)).toBe('2026-10-23')
    expect(dueFromWeeks(20, NOW)).toBe('2027-03-12')
    expect(dueFromWeeks(42, NOW)).toBe('2026-10-09')
    expect(dueFromWeeks(50, NOW)).toBe('2026-10-09')
    expect(dueFromWeeks(-3, NOW)).toBe('2027-07-30')
    for (const w of [0, 13, 14, 22, 28, 40, 42]) {
      expect(weeksOf(dueFromWeeks(w, NOW), NOW)).toBe(w)
      expect(dueValid(dueFromWeeks(w, NOW), NOW)).toBe(true)
    }
  })
  it('height converts both ways', () => {
    expect(cmToFtIn(168)).toEqual([5, 6])
    expect(ftInToCm(5, 6)).toBe(168)
  })
})

describe('female media', () => {
  it('maps female variants to their base by name', () => {
    expect(FEMALE_OF['2799'].id).toBe('2800')
    expect(FEMALE_OF['2802'].id).toBe('2801')
    expect(Object.keys(FEMALE_OF).length).toBe(2)
  })
  it('hides variant rows from lists but keeps them resolvable', () => {
    expect(EXDB.some(e => e.id === '2800' || e.id === '2801')).toBe(false)
    expect(EXIDX['2800']).toBeTruthy()
    // a female entry without a base stays a normal exercise
    expect(EXDB.some(e => e.id === '2327')).toBe(true)
  })
  it('strips (male)/(female) from names', () => {
    expect(EXDB.some(e => / \((male|female)\)$/.test(e.n))).toBe(false)
    expect(EXIDX['3470'].n).toBe('forward lunge')
    expect(EXIDX['2327'].n).toBe('dumbbell reverse grip row')
  })
  it('mediaOf swaps pictures only for a female profile', () => {
    const base = EXIDX['2799'], fem = EXIDX['2800']
    const m = mediaOf(base, F)
    expect(m.img).toBe(fem.img)
    expect(m.gif).toBe(fem.gif)
    expect(m.id).toBe('2799')
    expect(m.n).toBe(base.n)
    expect(mediaOf(base, M)).toBe(base)
    expect(mediaOf(base, { profile: null })).toBe(base)
    expect(mediaOf(EXIDX['0001'], F)).toBe(EXIDX['0001'])
  })
})
