// The MCP connector's tool handlers (supabase/functions/gym-mcp/tools.js) against a fake
// gym_get / gym_put that behaves like the real one (server _ts, 409 on a stale base).
import { describe, it, expect } from 'vitest'
import { callTool, search, norm, TOOLS, localNow } from '../../../supabase/functions/gym-mcp/tools.js'
import { pregOf } from '../../../supabase/functions/gym-mcp/_gen/pregnancy.js'

const NOW = new Date(2026, 9, 23, 12).getTime()
// Due 2027-03-15 → 2026-10-23 is week 19+4 (T2).
const preg = (exp = 'regular') => ({ sex: 'female', name: 'Dana', exp, heightCm: 165, preg: { due: '2027-03-15', clear: 'yes', clearAt: 1, twins: false }, at: 1 })

function fakeDb(state, { conflicts = 0 } = {}) {
  const db = { state: state && { _ts: 100, ...state }, puts: 0, gets: 0 }
  db.rpc = async (fn, args) => {
    if (fn === 'gym_get') { db.gets++; return db.state && JSON.parse(JSON.stringify(db.state)) }
    if (fn === 'gym_put') {
      if (conflicts > 0) { conflicts--; db.state._ts++; throw Object.assign(new Error('state changed on the server'), { status: 409 }) }
      if (db.state && args.base !== db.state._ts) throw Object.assign(new Error('stale'), { status: 409 })
      db.puts++
      db.state = { ...args.s, _ts: (db.state?._ts || 0) + 1 }
      return db.state._ts
    }
    throw new Error('rpc not allowed: ' + fn)
  }
  db.ctx = { rpc: db.rpc, now: () => NOW }
  db.call = (name, args) => callTool(name, args, db.ctx)
  return db
}

describe('search_exercises', () => {
  it('finds by name, exact match first', () => {
    const r = search({}, { query: 'barbell bench press' }, NOW)
    expect(r.results[0]).toMatchObject({ id: '0025', name: 'barbell bench press', equipment: 'barbell', target: 'pectorals' })
    expect(r.results[0].label).toBeUndefined()   // no labels outside pregnancy
  })
  it('matches a partial name and plurals', () => {
    expect(search({}, { query: 'goblet squats' }, NOW).results.map(x => x.id)).toContain('1760')
  })
  it('filters by target and equipment', () => {
    const r = search({}, { target: 'glutes', equipment: ['dumbbell'], limit: 25 }, NOW)
    expect(r.results.length).toBeGreaterThan(0)
    r.results.forEach(x => { expect(x.equipment).toBe('dumbbell'); expect(x.target).toBe('glutes') })
  })
  it('leaves out avoid exercises in pregnancy by default, labels the rest', () => {
    const S = { profile: preg() }
    const r = search(S, { query: 'box jump' }, NOW)
    expect(r.results.map(x => x.id)).not.toContain('1374')
    r.results.forEach(x => expect(['ok', 'caution', 'recommended']).toContain(x.label))
    expect(search(S, { query: 'box jump', pregnancy_safe: false }, NOW).results.find(x => x.id === '1374').label).toBe('avoid')
  })
  it('looks up exact ids, including customs', () => {
    const S = { customEx: [{ id: 'c1', n: 'My row', bp: 'back' }] }
    expect(search(S, { ids: ['0025', 'c1', 'nope'] }, NOW).results.map(x => x.id)).toEqual(['0025', 'c1'])
  })
  it('hides "(female)" twins and strips the "(male)" suffix', () => {
    const r = search({}, { query: 'astride jumps', limit: 25 }, NOW)
    expect(r.results.every(x => !/\((fe)?male\)/.test(x.name))).toBe(true)
  })
  it('norm folds case, accents and plurals', () => {
    expect(norm('Push-Ups (male)')).toBe('push ups')
    expect(norm('Dips Raises')).toBe('dip raise')
    expect(norm('45° side bend')).toBe('45 side bend')
    expect(norm('Press')).toBe('press')
  })
})

describe('reads', () => {
  it('get_profile reports pregnancy week, trimester and avoid kinds', async () => {
    const db = fakeDb({ profile: preg('some'), unit: 'kg', bodyweight: [{ d: '2026-10-01', w: 61 }, { d: '2026-10-20', w: 62 }] })
    const { structuredContent: p } = await db.call('get_profile', {})
    expect(p).toMatchObject({ name: 'Dana', sex: 'female', unit: 'kg', latestBodyweight: { value: 62, date: '2026-10-20' } })
    expect(p.pregnancy).toMatchObject({ week: 19, trimester: 2, dueDate: '2027-03-15' })
    const avoid = p.pregnancy.avoid.map(x => x.rule)
    expect(avoid).toContain('prone')
    expect(avoid).toContain('plyometric')          // not a consistent lifter: jumping becomes avoid
  })
  it('get_profile with no profile', async () => {
    const { structuredContent: p } = await fakeDb(null).call('get_profile', {})
    expect(p).toMatchObject({ name: null, pregnancy: null, unit: 'kg' })
  })
  it('get_routines returns exercises and the 7-day week', async () => {
    const db = fakeDb({ routines: [{ id: 'A', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 8, weight: 40 }] }], week: { 1: 'A' } })
    const { structuredContent: o } = await db.call('get_routines', {})
    expect(o.routines[0].ex[0]).toMatchObject({ id: '0025', name: 'barbell bench press', sets: 3, reps: 8, weight: 40 })
    expect(o.week).toEqual({ 0: null, 1: 'A', 2: null, 3: null, 4: null, 5: null, 6: null })
  })
  it('get_recent_workouts summarises work sets within the window', async () => {
    const db = fakeDb({ workouts: [
      { id: 1, d: '2026-08-01', name: 'Old', entries: [] },
      { id: 2, d: '2026-10-20', name: 'Push', entries: [{ id: '0025', sets: [{ w: 20, r: 10, done: true, tech: 'warmup' }, { w: 40, r: 8, done: true }, { w: 45, r: 5, done: false }] }] }
    ] })
    const { structuredContent: o } = await db.call('get_recent_workouts', {})
    expect(o.workouts).toEqual([{ id: 2, date: '2026-10-20', routineName: 'Push', entries: [{ id: '0025', name: 'barbell bench press', sets: 1, topWeight: 40, topReps: 8 }] }])
  })
})

describe('writes', () => {
  it('create_routine writes through gym_put with the read base', async () => {
    const db = fakeDb({ routines: [] })
    const r = await db.call('create_routine', { name: 'Legs', emoji: '🦵', ex: [{ id: '1760', sets: 3, reps: 10, weight: 12 }] })
    expect(r.isError).toBeUndefined()
    expect(r.structuredContent.status).toBe('created')
    expect(db.state.routines).toHaveLength(1)
    expect(db.state.routines[0]).toMatchObject({ name: 'Legs', emoji: '🦵', ex: [{ id: '1760', sets: 3, reps: 10, weight: 12 }] })
  })
  it('rejects unknown ids and unknown fields without writing', async () => {
    const db = fakeDb({ routines: [] })
    const a = await db.call('create_routine', { name: 'X', ex: [{ id: '9999x', sets: 3 }] })
    expect(a.isError).toBe(true)
    expect(a.structuredContent).toMatchObject({ error: 'unknown_id', id: '9999x' })
    const b = await db.call('create_routine', { name: 'X', ex: [{ id: '0025', sets: 3, prog: 'lp' }] })
    expect(b.isError).toBe(true)
    expect(b.content[0].text).toMatch(/unknown field "prog"/)
    const c = await db.call('create_routine', { name: 'X', ex: [{ id: '0025', sets: 30 }] })
    expect(c.isError).toBe(true)
    expect(db.puts).toBe(0)
  })
  it('pregnancy guard: avoid needs the id confirmed one by one, caution only warns', async () => {
    const db = fakeDb({ profile: preg(), routines: [] })
    const ex = [{ id: '1374', sets: 3, reps: 5 }, { id: '0060', sets: 3, reps: 10 }]
    const a = await db.call('create_routine', { name: 'Mix', ex })
    expect(a.structuredContent.status).toBe('needs_confirmation')
    const w = a.structuredContent.warnings.find(x => x.id === '1374')
    expect(w).toMatchObject({ label: 'avoid', reason: expect.stringMatching(/box/) })
    expect(w.swaps.length).toBeGreaterThan(0)
    expect(db.puts).toBe(0)
    const b = await db.call('create_routine', { name: 'Mix', ex, confirm_avoid_ids: ['9999'] })
    expect(b.structuredContent.status).toBe('needs_confirmation')
    const c = await db.call('create_routine', { name: 'Mix', ex, confirm_avoid_ids: ['1374'] })
    expect(c.structuredContent.status).toBe('created')
    expect(c.structuredContent.warnings.map(x => x.label).sort()).toEqual(['avoid', 'caution'])
    expect(db.puts).toBe(1)
  })
  it('update_routine replaces the list; a guard block leaves it untouched', async () => {
    const db = fakeDb({ profile: preg(), routines: [{ id: 'A', name: 'Push', ex: [{ id: '0025', sets: 3 }] }] })
    const a = await db.call('update_routine', { routine_id: 'A', ex: [{ id: '1374', sets: 3 }] })
    expect(a.structuredContent.status).toBe('needs_confirmation')
    const b = await db.call('update_routine', { routine_id: 'A', name: 'Legs', ex: [{ id: '1760', sets: 4, reps: 12 }] })
    expect(b.structuredContent.status).toBe('updated')
    expect(db.state.routines[0]).toMatchObject({ name: 'Legs', ex: [{ id: '1760', sets: 4, reps: 12 }] })
    expect((await db.call('update_routine', { routine_id: 'nope', name: 'x' })).isError).toBe(true)
  })
  it('set_week_schedule changes only the given days; delete_routine clears its days', async () => {
    const db = fakeDb({ routines: [{ id: 'A', name: 'Push', ex: [] }, { id: 'B', name: 'Pull', ex: [] }], week: { 1: 'A', 3: 'B' }, dayPlan: { '2026-10-24': 'A' } })
    const a = await db.call('set_week_schedule', { week: { 3: null, 5: 'A' } })
    expect(a.structuredContent.week).toMatchObject({ 1: 'A', 3: null, 5: 'A' })
    expect((await db.call('set_week_schedule', { week: { 2: 'Z' } })).isError).toBe(true)
    expect((await db.call('set_week_schedule', { week: { 7: 'A' } })).isError).toBe(true)
    const d = await db.call('delete_routine', { routine_id: 'A' })
    expect(d.structuredContent).toEqual({ status: 'deleted', name: 'Push' })
    expect(db.state.routines.map(r => r.id)).toEqual(['B'])
    expect(db.state.week).toEqual({})
    expect(db.state.dayPlan).toEqual({})
  })
  it('re-reads and re-applies once on a 409, then gives up with a clear message', async () => {
    const once = fakeDb({ routines: [] }, { conflicts: 1 })
    expect((await once.call('create_routine', { name: 'A', ex: [{ id: '0025', sets: 3 }] })).structuredContent.status).toBe('created')
    expect(once.gets).toBe(2)
    const twice = fakeDb({ routines: [] }, { conflicts: 2 })
    const r = await twice.call('create_routine', { name: 'A', ex: [{ id: '0025', sets: 3 }] })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/changed on another device/)
    expect(twice.state.routines).toEqual([])
  })
  it('first write for a user with no state yet', async () => {
    const db = fakeDb(null)
    expect((await db.call('create_routine', { name: 'A', ex: [{ id: '0025', sets: 3 }] })).structuredContent.status).toBe('created')
    expect(db.state.routines).toHaveLength(1)
  })
  it('log_workout saves a finished workout with volume, PRs and exWeights', async () => {
    const db = fakeDb({ routines: [], workouts: [], bodyweight: [{ d: '2026-10-20', w: 76.5 }], exWeights: { '0603': { w: 10, d: '2026-10-01' } } })
    const r = await db.call('log_workout', { name: 'Trainer', entries: [{ id: '0603', sets: [{ weight: 15, reps: 15 }, { weight: 15, reps: 12 }] }, { id: '0179', sets: [{ weight: 50, reps: 10 }] }] })
    expect(r.structuredContent).toMatchObject({ status: 'logged', date: '2026-10-23', sets: 3, volume: 905, prs: ['0603'] })
    const w = db.state.workouts[0]
    expect(w).toMatchObject({ d: '2026-10-23', name: 'Trainer', bw: 76.5, routineId: null })
    expect(w.entries[0].sets[0]).toEqual({ w: 15, r: 15, done: true })
    expect(db.state.exWeights).toMatchObject({ '0603': { w: 15 }, '0179': { w: 50 } })
    expect((await db.call('log_workout', { entries: [{ id: '9999x', sets: [{ reps: 5 }] }] })).isError).toBe(true)
    expect((await db.call('log_workout', { date: '26/10', entries: [{ id: '0025', sets: [{ reps: 5 }] }] })).isError).toBe(true)
    expect(db.state.workouts).toHaveLength(1)
  })
  it('log_workout keeps set types: drop/myo parts, warm-ups out of stats, partials', async () => {
    const db = fakeDb({ routines: [], workouts: [], bodyweight: [] })
    const r = await db.call('log_workout', { entries: [{ id: '0576', sets: [
      { weight: 50, reps: 5, tech: 'warmup' }, { weight: 35, reps: 8, tech: 'fail', partials: 3 },
      { weight: 35, reps: 6, tech: 'drop', parts: [{ weight: 20, reps: 4 }, { weight: 10, reps: 8 }] },
      { weight: 20, reps: 12, tech: 'myo', parts: [{ weight: 20, reps: 5 }] }] }] })
    expect(r.structuredContent).toMatchObject({ status: 'logged', sets: 3, volume: 35 * 8 + 35 * 6 + 80 + 80 + 240 + 100 })
    const ss = db.state.workouts[0].entries[0].sets
    expect(ss[0]).toEqual({ w: 50, r: 5, done: true, tech: 'warmup' })
    expect(ss[1]).toEqual({ w: 35, r: 8, done: true, tech: 'fail', partials: 3 })
    expect(ss[2]).toEqual({ w: 35, r: 6, done: true, tech: 'drop', parts: [{ w: 20, r: 4 }, { w: 10, r: 8 }] })
    expect(db.state.exWeights['0576'].w).toBe(35)   // the warm-up's 50 is not a PR
    const bad = (x) => db.call('log_workout', { entries: [{ id: '0576', sets: [x] }] })
    expect((await bad({ reps: 5, tech: 'superset' })).isError).toBe(true)
    expect((await bad({ reps: 5, parts: [{ reps: 3 }] })).isError).toBe(true)
    expect((await bad({ reps: 5, tech: 'fail', parts: [{ reps: 3 }] })).isError).toBe(true)
    expect(db.state.workouts).toHaveLength(1)
  })
  it('delete_workout removes a logged workout by the id get_recent_workouts gives', async () => {
    const db = fakeDb({ routines: [], workouts: [], bodyweight: [] })
    await db.call('log_workout', { entries: [{ id: '0025', sets: [{ weight: 40, reps: 8 }] }] })
    const id = (await db.call('get_recent_workouts', {})).structuredContent.workouts[0].id
    expect((await db.call('delete_workout', { workout_id: 'nope' })).isError).toBe(true)
    expect((await db.call('delete_workout', { workout_id: id })).structuredContent).toMatchObject({ status: 'deleted', date: '2026-10-23' })
    expect(db.state.workouts).toEqual([])
  })
  it('unknown tool and every tool has a schema', async () => {
    expect((await fakeDb({}).call('drop_tables', {})).isError).toBe(true)
    TOOLS.forEach(t => { expect(t.inputSchema.type).toBe('object'); expect(t.annotations).toBeTruthy() })
  })
})

describe('pregnancy dates', () => {
  it('trimester boundary at week 14 and local timezone shift', () => {
    const S = { profile: { ...preg(), preg: { due: '2027-04-15', clear: 'yes' } } }
    // 2027-04-15 minus 26 weeks = 2026-10-15 (week 14+0)
    expect(pregOf(S, new Date(2026, 9, 14, 12).getTime())).toMatchObject({ week: 13, day: 6, tri: 1 })
    expect(pregOf(S, new Date(2026, 9, 15, 12).getTime())).toMatchObject({ week: 14, day: 0, tri: 2 })
    expect(pregOf({ profile: { ...preg(), sex: 'male' } }, NOW)).toBeNull()
    const utc = Date.UTC(2026, 9, 23, 23, 30)
    expect(localNow({ reminder: { tz: 'Asia/Jerusalem' } }, utc) - utc).toBe(3 * 3600e3)
    expect(localNow({}, utc)).toBe(utc)
  })
})
