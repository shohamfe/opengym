import { describe, it, expect } from 'vitest'
import { pregOf, labelOf, reasonOf, gentle, notConsistent, conceptionISO } from './pregnancy.js'
import { PREG, RULES, NC_REASON } from './pregnancy-labels.js'
import { EXIDX } from './exercises.js'

// Run under several zones too: TZ=America/Los_Angeles / Asia/Jerusalem / Pacific/Kiritimati npx vitest run src/lib/pregnancy.test.js
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
// Local "today" just after midnight and just before it: the result must not move.
const NOWS = [new Date(2026, 9, 23, 0, 5).getTime(), new Date(2026, 9, 23, 23, 55).getTime()]
const dueIn = days => iso(new Date(2026, 9, 23 + days, 12))
const P = (due, extra = {}) => ({ profile: { sex: 'female', exp: 'regular', preg: { due, clear: 'yes' }, ...extra } })
const at = (w, d) => 280 - (w * 7 + d)   // days to due at week w + d

describe('pregOf (local-time trimester math)', () => {
  const cases = [
    [at(0, 0), 0, 0, 1], [at(13, 6), 13, 6, 1], [at(14, 0), 14, 0, 2], [at(20, 3), 20, 3, 2],
    [at(27, 6), 27, 6, 2], [at(28, 0), 28, 0, 3], [0, 40, 0, 3], [-10, 41, 3, 3]
  ]
  for (const [days, week, day, tri] of cases) {
    it(`due in ${days} d -> ${week}+${day}, T${tri}`, () => {
      for (const now of NOWS) expect(pregOf(P(dueIn(days)), now)).toEqual({ week, day, tri, due: dueIn(days) })
    })
  }
  it('a due date more than 40 weeks out counts as week 0', () => {
    expect(pregOf(P(dueIn(300)), NOWS[0])).toMatchObject({ week: 0, day: 0, tri: 1 })
  })
  it('crosses DST changes without slipping a day (Mar and Apr 2027 due dates)', () => {
    for (const now of NOWS) {
      expect(pregOf(P('2027-03-28'), now)).toMatchObject({ week: 17, day: 5, tri: 2 })   // 156 days out
      expect(pregOf(P('2027-04-04'), now)).toMatchObject({ week: 16, day: 5, tri: 2 })   // 163 days out
    }
  })
  it('null without a pregnant female profile or with a bad date', () => {
    expect(pregOf({})).toBe(null)
    expect(pregOf({ profile: null })).toBe(null)
    expect(pregOf({ profile: { sex: 'female', preg: null } })).toBe(null)
    expect(pregOf({ profile: { sex: 'male', preg: { due: dueIn(100) } } })).toBe(null)
    expect(pregOf(P('2027-3-1'))).toBe(null)
    expect(pregOf(P('not a date'))).toBe(null)
  })
  it('conception is due - 280 days', () => {
    expect(conceptionISO(P('2027-03-28'))).toBe('2026-06-21')
  })
})

describe('labelOf / reasonOf', () => {
  const T1 = P(dueIn(at(10, 0))), T2 = P(dueIn(at(20, 0))), T3 = P(dueIn(at(30, 0)))
  const now = NOWS[0]
  it('hanging leg raise: no badge in T1, avoid from T2', () => {
    expect(labelOf('0472', T1, now)).toBe(null)
    expect(labelOf('0472', T2, now)).toBe('avoid')
    expect(reasonOf('0472', T2, now)).toBe(RULES.abs_high_load)
  })
  it('bench press: take care from T2 (supine)', () => {
    expect(labelOf('0025', T1, now)).toBe(null)
    expect(labelOf('0025', T3, now)).toBe('caution')
    expect(reasonOf('0025', T3, now)).toBe(RULES.supine)
  })
  it('goblet squat and the 12 built-ins are good picks', () => {
    expect(labelOf('1760', T1, now)).toBe('rec')
    expect(reasonOf('1760', T1, now)).toBe(RULES.recommended)
    for (let i = 9002; i <= 9013; i++) expect(labelOf(String(i), T2, now)).toBe('rec')
  })
  it('not a consistent lifter: jumping becomes avoid from T1 with its own reason', () => {
    expect(labelOf('2612', T1, now)).toBe('caution')
    const nc = P(dueIn(at(10, 0)), { exp: 'some' })
    expect(notConsistent(nc)).toBe(true)
    expect(labelOf('2612', nc, now)).toBe('avoid')
    expect(reasonOf('2612', nc, now)).toBe(NC_REASON)
  })
  it('no labels for male, no profile, not pregnant, unknown ids', () => {
    expect(labelOf('0472', { profile: { sex: 'male', exp: 'regular', preg: { due: dueIn(100) } } }, now)).toBe(null)
    expect(labelOf('0472', {}, now)).toBe(null)
    expect(labelOf('0472', { profile: { sex: 'female', preg: null } }, now)).toBe(null)
    expect(labelOf('cXYZ', T2, now)).toBe(null)
    expect(reasonOf('0043', T2, now)).toBe(null)   // barbell squat: ok, no badge
  })
  it('every labelled id exists in the exercise library', () => {
    expect(Object.keys(PREG).filter(id => !EXIDX[id])).toEqual([])
  })
})

describe('gentle', () => {
  it('on for limits and not yet, off when cleared or not pregnant', () => {
    const p = clear => ({ profile: { sex: 'female', preg: { due: dueIn(100), clear } } })
    expect(gentle(p('yes'))).toBe(false)
    expect(gentle(p('limits'))).toBe(true)
    expect(gentle(p('notyet'))).toBe(true)
    expect(gentle({ profile: { sex: 'female', preg: null } })).toBe(false)
  })
})
