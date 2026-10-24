import { describe, it, expect, vi, beforeEach } from 'vitest'

// The pregnancy contract is owned by lib/pregnancy.js; here it is driven by hand so the
// avoid/[R] handling can be tested without depending on the label data.
const P = vi.hoisted(() => ({ preg: null, labels: {} }))
vi.mock('./pregnancy.js', () => ({
  pregOf: () => P.preg,
  labelOf: id => (P.preg ? P.labels[id] || null : null),
  reasonOf: id => (P.labels[id] === 'avoid' ? 'lying on my belly' : null)
}))

import { norm, extractPlan, matchOne, matchExercises, cfgFor, initialRes, openCount, isOpen, toBundle, rowKey, buildPrompt, fuzzy } from './ai-import.js'
import { mergePlan } from './plan-share.js'

const S0 = (o = {}) => ({ unit: 'kg', routines: [], week: {}, bodyweight: [], customEx: [], ...o })
const plan = (ex, o = {}) => ({ opengym_plan: 1, source: 'ai', routines: [{ id: 'A', name: 'Full A', ex }], ...o })
beforeEach(() => { P.preg = null; P.labels = {} })

describe('norm', () => {
  it('lowercases, strips accents, symbols and (male)/(female)', () => {
    expect(norm('Push-Ups')).toBe('push up')
    expect(norm('Sled 45° Leg Press')).toBe('sled 45 leg press')
    expect(norm('Crème Brûlée Curl')).toBe('creme brulee curl')
    expect(norm('glute bridge two legs on bench (male)')).toBe('glute bridge two leg on bench')
    expect(norm('side lying hip adduction (female)')).toBe('side lying hip adduction')
  })
  it('folds versions and singularises, but leaves press and short words', () => {
    expect(norm('weighted russian twist v. 2')).toBe('weighted russian twist v2')
    expect(norm('Russian twist version 2')).toBe('russian twist v2')
    expect(norm('calf raises')).toBe('calf raise')
    expect(norm('dips')).toBe('dip')
    expect(norm('bench press')).toBe('bench press')
    expect(norm('as')).toBe('as')
  })
})

describe('extractPlan', () => {
  const json = JSON.stringify(plan([{ id: '0662', name: 'push-up' }]))
  it('finds a fenced block inside prose', () => {
    const r = extractPlan('Great! Here is your plan:\n\n```json\n' + json + '\n```\nEnjoy {and good luck}.')
    expect(r.plan.routines[0].ex[0].id).toBe('0662')
    expect(r.count).toBe(1)
  })
  it('takes the last of two plans and says so', () => {
    const v2 = JSON.stringify(plan([{ id: '0251', name: 'chest dip' }]))
    const r = extractPlan('Draft:\n```json\n' + json + '\n```\nFinal:\n```\n' + v2 + '\n```')
    expect(r.count).toBe(2)
    expect(r.plan.routines[0].ex[0].id).toBe('0251')
  })
  it('accepts bare JSON, trailing commas and // comments, BOM and zero-width chars', () => {
    const sloppy = '﻿{\n "opengym_plan": 1, // v1\n "routines": [ { "name": "A​", "ex": [ { "id": "0662", "name": "push-up // not a comment", }, ], }, ],\n}'
    const r = extractPlan(sloppy)
    expect(r.plan.routines[0].ex[0].name).toBe('push-up // not a comment')
  })
  it('repairs smart quotes only when the raw text fails', () => {
    const r = extractPlan('{“opengym_plan”: 1, “routines”: [{“name”: “A”, “ex”: [{“name”: “push-up”}]}]}')
    expect(r.plan.routines[0].ex[0].name).toBe('push-up')
  })
  it('reports a plan that was cut off', () => {
    expect(extractPlan('Here you go:\n```json\n' + json.slice(0, 60))).toEqual({ error: 'cutoff' })
  })
  it('reports no plan and an empty plan', () => {
    expect(extractPlan('Sure, what days can you train?')).toEqual({ error: 'none' })
    expect(extractPlan('{"a": 1}')).toEqual({ error: 'none' })
    expect(extractPlan('{"opengym_plan": 1, "routines": []}')).toEqual({ error: 'empty' })
    expect(extractPlan('{"opengym_plan": 1}')).toEqual({ error: 'empty' })
  })
})

describe('matchOne (spec matching rows 1-5)', () => {
  const S = S0()
  it('1: id and name agree', () => {
    expect(matchOne({ id: '0662', name: 'Push-up' }, S)).toMatchObject({ status: 'ok', how: 'exact', pick: '0662' })
  })
  it('2: id right, name close enough (Jaccard >= 0.8)', () => {
    expect(matchOne({ id: '0662', name: 'push-ups' }, S)).toMatchObject({ status: 'ok', pick: '0662' })
    expect(matchOne({ id: 662, name: 'push-up' }, S)).toMatchObject({ status: 'ok', pick: '0662' })   // number id, padded
  })
  it('3: real id for a different exercise → review, name match offered first', () => {
    const r = matchOne({ id: '0251', name: 'push-up' }, S)
    expect(r).toMatchObject({ status: 'review', how: 'mismatch', pick: null })
    expect(r.sugg).toEqual(['0662', '0251'])
  })
  it('4: no id, exact name or alias → accepted as matched by name', () => {
    expect(matchOne({ id: null, name: 'Dumbbell Lateral Raises' }, S)).toMatchObject({ status: 'ok', how: 'name', pick: '0334' })
    expect(matchOne({ id: '9999', name: 'RDL' }, S)).toMatchObject({ status: 'ok', how: 'name', pick: '0085' })
    expect(matchOne({ name: 'hip thrust' }, S)).toMatchObject({ status: 'ok', pick: '1409' })
  })
  it('4b: a duplicated library name takes the lowest id', () => {
    expect(matchOne({ name: 'lever chest press' }, S).pick).toBe('0576')
    expect(matchOne({ name: 'barbell seated calf raise' }, S).pick).toBe('0088')
  })
  it('custom exercises match by name too, ahead of the library', () => {
    const Sc = S0({ customEx: [{ id: 'cX', n: 'Push-up', bp: 'chest', eq: 'custom' }] })
    expect(matchOne({ name: 'push up' }, Sc).pick).toBe('cX')
  })
  it('5: nothing exact → unmatched with fuzzy suggestions', () => {
    const r = matchOne({ id: null, name: 'dumbell walking lunges' }, S)
    expect(r.status).toBe('unmatched')
    expect(r.sugg.length).toBeGreaterThan(0)
    expect(r.sugg).toContain('1460')
    expect(fuzzy(norm('zzzz qqqq'), S)).toEqual([])
  })
  it('an exercise with no name and no valid id is kept, unmatched', () => {
    expect(matchOne({}, S)).toMatchObject({ status: 'unmatched', sugg: [] })
  })
})

describe('matchExercises', () => {
  it('never drops: every exercise, even a bare string, becomes a row', () => {
    const m = matchExercises(plan([{ id: '0662', name: 'push-up' }, 'plank', {}, { id: '0251', name: 'push-up' }]), S0())
    expect(m.routines[0].rows.map(r => r.status)).toEqual(['ok', 'unmatched', 'unmatched', 'review'])
    expect(m.routines[0].rows[1].ai.name).toBe('plank')
  })
  it('converts lb to kg and snaps lifts to 0.5', () => {
    const m = matchExercises(plan([{ id: '0025', name: 'barbell bench press', weight: 100 }], { unit: 'lb' }), S0())
    expect(m.routines[0].rows[0].raw.weight).toBe(45.5)
    expect(m.warnings).toContainEqual({ k: 'unit', from: 'lb', to: 'kg' })
    const same = matchExercises(plan([{ id: '0025', name: 'barbell bench press', weight: 100 }]), S0({ unit: 'lb' }))
    expect(same.routines[0].rows[0].raw.weight).toBe(100)    // no unit given → assume yours
  })
  it('coerces strings, clamps out-of-range numbers, splits rep ranges, ignores fields it must not set', () => {
    const m = matchExercises(plan([{ id: '0662', name: 'push-up', sets: '20', reps: '8-12', prog: 'dp', inc: 5, bodyweight: false, junk: 1 }]), S0())
    const raw = m.routines[0].rows[0].raw
    expect(raw).toEqual({ sets: 10, reps: 12, repsMin: 8, repsMax: 12 })
    expect(m.warnings).toContainEqual({ k: 'clamped', n: 1 })
  })
  it('names routines, dedupes ids, suffixes a name you already have, caps at 14', () => {
    const rs = Array.from({ length: 15 }, (_, i) => ({ name: i ? 'R' + i : 'Push', ex: [{ name: 'push-up' }] }))
    rs[2].id = 'X'; rs[3].id = 'X'
    const m = matchExercises({ opengym_plan: 1, routines: rs }, S0({ routines: [{ id: 'z', name: 'push', ex: [] }] }))
    expect(m.routines).toHaveLength(14)
    expect(m.routines[0]).toMatchObject({ id: 'R1', name: 'Push (AI)' })
    expect(m.routines[2].id).not.toBe(m.routines[3].id)
    expect(m.warnings).toContainEqual({ k: 'routines', n: 15 })
  })
  it('keeps week days that point at a routine and warns about the rest', () => {
    const m = matchExercises(plan([{ name: 'push-up' }], { week: { 1: 'A', 3: 'B', 9: 'A', 5: null } }), S0())
    expect(m.week).toEqual({ 1: 'A' })
    expect(m.warnings).toContainEqual({ k: 'week', n: 1 })
  })
})

describe('cfgFor', () => {
  it('fills editor defaults and the AI numbers by mode', () => {
    expect(cfgFor('0662', { sets: 4, reps: 12 })).toMatchObject({ id: '0662', sets: 4, reps: 12, mode: 'reps', bodyweight: true })
    expect(cfgFor('0464', { sets: 3, sec: 30 })).toMatchObject({ mode: 'time', sec: 30, sets: 3 })
    expect(cfgFor('0464', { sets: 3, sec: 30, reps: 10 })).toMatchObject({ mode: 'reps', reps: 10 })
    expect(cfgFor('0685', { min: 25, speed: 9, reps: 5 })).toEqual({ id: '0685', sets: 1, min: 25, speed: 9 })
    expect(cfgFor('0025', {})).toMatchObject({ sets: 3, reps: 10 })
  })
  it('turns per-side reps from the AI into the stored total', () => {
    expect(cfgFor('1460', { reps: 10 }, true)).toMatchObject({ side: true, reps: 20 })
    expect(cfgFor('1460', { reps: 20 }, false)).toMatchObject({ side: true, reps: 20 })
  })
})

describe('review state → bundle → mergePlan', () => {
  it('blocks until every row is resolved, then merges additively', () => {
    const m = matchExercises(plan([{ id: '0662', name: 'push-up', sets: 3, reps: 8 }, { id: '0251', name: 'push-up' }, { name: 'zzzz qqqq' }], { week: { 1: 'A' } }), S0())
    const res = initialRes(m)
    expect(openCount(m, res, S0())).toBe(2)
    res[rowKey(0, 1)] = { id: '0662' }
    res[rowKey(0, 2)] = 'skip'
    expect(openCount(m, res, S0())).toBe(0)
    const b = toBundle(m, res)
    expect(b.exerciseCount).toBe(2)
    const s = S0({ routines: [{ id: 'mine', name: 'Mine', ex: [] }], week: { 1: 'mine' } })
    mergePlan(s, b, { schedule: false })
    expect(s.routines).toHaveLength(2)
    expect(s.routines[0]).toEqual({ id: 'mine', name: 'Mine', ex: [] })
    expect(s.routines[1].ex.map(e => e.id)).toEqual(['0662', '0662'])
    expect(s.week[1]).toBe('mine')
  })
})

describe('pregnancy', () => {
  const preg = { week: 20, day: 1, tri: 2, due: '2027-03-01' }
  it('flags an avoided exercise; only Keep or Skip resolves it', () => {
    P.preg = preg; P.labels = { '0662': 'avoid' }
    const S = S0({ profile: { sex: 'female', preg: { clear: 'yes' } } })
    const m = matchExercises(plan([{ id: '0662', name: 'push-up' }]), S)
    expect(m.routines[0].rows[0]).toMatchObject({ status: 'avoid', reason: 'lying on my belly', pick: '0662' })
    const res = initialRes(m)
    expect(openCount(m, res, S)).toBe(1)
    expect(isOpen({ id: '0662', keep: true }, S)).toBe(false)
    expect(isOpen('skip', S)).toBe(false)
    P.preg = null
    expect(openCount(m, res, S)).toBe(0)     // not pregnant → no gate
  })
  it('prompt carries the week, the avoid reasons and [R]; "remove pregnancy info" leaves all of it out', () => {
    P.preg = preg; P.labels = { '0662': 'avoid', '0251': 'rec' }
    const S = S0({ profile: { sex: 'female', exp: 'some', preg: { clear: 'limits' } } })
    const p = buildPrompt(S)
    expect(p).toContain('PREGNANT: week 20 (trimester 2), due 2027-03-01')
    expect(p).toContain('set some limits')
    expect(p).toContain('NEVER use these (avoid): lying on my belly')
    expect(p).toContain('0251|chest dip|body weight [R]')
    expect(p).not.toContain('0662|push-up|')
    const q = buildPrompt(S, { noPreg: true })
    expect(q).not.toMatch(/PREGNAN|\[R\]/)
    expect(q).toContain('0662|push-up|body weight')
  })
})

describe('buildPrompt', () => {
  it('stays under the size budget and keeps the ids already in your routines', () => {
    const S = S0({
      unit: 'lb', bodyweight: [{ d: '2026-10-01', w: 150 }],
      profile: { sex: 'male', heightCm: 180, exp: 'regular' },
      routines: [{ id: 'r', name: 'Legs', ex: [{ id: '1371', sets: 3, reps: 12, weight: 90 }, { id: '0464', mode: 'time', sets: 3, sec: 40 }] }]
    })
    const p = buildPrompt(S, { lang: 'de' })
    expect(p.length / 3.3).toBeLessThan(9000)
    expect(p).toContain('Talk with me in Deutsch')
    expect(p).toContain('Height: 71 in. Weight: 150 lb')
    expect(p).toContain('- Legs: barbell seated calf raise 3x12 @ 90 lb; front plank with twist 3x40s')
    expect(p).toContain('1371|barbell seated calf raise|barbell')
    expect(p).toContain('"unit": "lb"')
    expect(p).not.toContain('(female)')
    // the template's own example plan must round-trip through extraction
    expect(extractPlan(p).plan.source).toBe('ai')
  })
})
