// The openGym MCP tools, as plain JS with no Deno or network code, so the frontend's vitest can
// test them (frontend/src/lib/mcp-tools.test.js). index.ts supplies ctx.rpc, which calls the
// user's own gym_get / gym_put with their token, so RLS, the definer checks and the 409 base
// check all apply exactly as they do for the app.
import { CATALOG } from './_gen/catalog.js'
import { pregOf, labelOf, reasonOf } from './_gen/pregnancy.js'
import { PREG } from './_gen/pregnancy-labels.js'

const BUILTIN = new Map(CATALOG.map(([id, n, eq, tg, bp]) => [id, { id, n, eq, tg, bp }]))
const FEMALE = / \(female\)$/
const shown = n => String(n || '').replace(/ \((male|female)\)$/, '')

export const norm = s => String(s || '').replace(/\((male|female)\)/gi, ' ').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/°/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(v|version) (\d)\b/g, 'v$2')
  .split(' ').filter(Boolean).map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ')

function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}
const jac = (a, b) => { const A = new Set(a.split(' ')), B = new Set(b.split(' ')); let n = 0; A.forEach(x => { if (B.has(x)) n++ }); return n / (A.size + B.size - n || 1) }

// Built-ins plus the user's own custom exercises.
const lookup = (S, id) => {
  if (BUILTIN.has(id)) return BUILTIN.get(id)
  const c = (S.customEx || []).find(x => x.id === id)
  return c && { id: c.id, n: c.n, eq: 'custom', tg: c.bp || '', bp: c.bp || '' }
}

const PL = { rec: 'recommended', caution: 'caution', avoid: 'avoid' }
function exOut(S, e, now) {
  const o = { id: e.id, name: shown(e.n), equipment: e.eq, target: e.tg }
  if (pregOf(S, now)) o.label = PL[labelOf(e.id, S, now)] || 'ok'
  return o
}

/* ------------------------------------------------------------------ input checks */

const fail = msg => { throw Object.assign(new Error(msg), { user: true }) }
function strict(obj, spec, where) {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) fail(`${where} must be an object`)
  for (const k of Object.keys(obj)) if (!(k in spec)) fail(`${where}: unknown field "${k}"`)
  for (const [k, chk] of Object.entries(spec)) if (obj[k] !== undefined) chk(obj[k], `${where}.${k}`)
  return obj
}
const int = (lo, hi) => (v, w) => { if (!Number.isInteger(v) || v < lo || v > hi) fail(`${w} must be a whole number ${lo}-${hi}`) }
const num = (lo, hi) => (v, w) => { if (typeof v !== 'number' || !isFinite(v) || v < lo || v > hi) fail(`${w} must be a number ${lo}-${hi}`) }
const str = (lo, hi) => (v, w) => { if (typeof v !== 'string' || v.trim().length < lo || v.length > hi) fail(`${w} must be text of ${lo}-${hi} characters`) }
const bool = (v, w) => { if (typeof v !== 'boolean') fail(`${w} must be true or false`) }
const oneOf = (...xs) => (v, w) => { if (!xs.includes(v)) fail(`${w} must be one of ${xs.join(', ')}`) }
const strList = (v, w) => { if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) fail(`${w} must be a list of strings`) }
const EXIN = { id: str(1, 40), sets: int(1, 10), reps: int(1, 100), repsMin: int(1, 100), repsMax: int(1, 100), mode: oneOf('reps', 'time'), sec: int(5, 3600), min: num(1, 300), speed: num(0.5, 30), weight: num(0, 1000), side: bool, sg: str(1, 12) }
const exList = (v, w) => {
  if (!Array.isArray(v) || v.length < 1 || v.length > 30) fail(`${w} must list 1-30 exercises`)
  v.forEach((e, i) => { strict(e, EXIN, `${w}[${i}]`); if (e.id === undefined || e.sets === undefined) fail(`${w}[${i}] needs id and sets`) })
}

/* ------------------------------------------------------------------ search */

export function search(S, a = {}, now = Date.now()) {
  const preg = !!pregOf(S, now)
  const safe = a.pregnancy_safe ?? preg
  const lim = a.limit ?? 10
  const all = [...(S.customEx || []).map(c => lookup(S, c.id)), ...CATALOG.map(r => BUILTIN.get(r[0]))]
  if (a.ids) {
    const results = a.ids.map(id => lookup(S, id)).filter(Boolean).map(e => exOut(S, e, now))
    return { results, total: results.length }
  }
  const q = norm(a.query)
  const tq = norm(a.target)
  const eqs = a.equipment && a.equipment.map(x => String(x).toLowerCase())
  const rows = []
  for (const e of all) {
    if (FEMALE.test(e.n)) continue                          // shown through its male twin
    if (tq && !norm(e.tg + ' ' + e.bp).includes(tq)) continue
    if (eqs && !eqs.includes(e.eq)) continue
    const lab = preg ? labelOf(e.id, S, now) : null
    if (safe && lab === 'avoid') continue
    const n = norm(e.n)
    let score = 1
    if (q) {
      score = n === q ? 2 : (0.6 * jac(q, n) + 0.4 * (1 - lev(q, n) / Math.max(q.length, n.length))) + (` ${n} `.includes(` ${q} `) ? 0.5 : 0) +
        (norm(e.tg + ' ' + e.bp).includes(q) ? 0.15 : 0)
      if (score < 0.45) continue
    }
    rows.push({ e, n, score: score + (lab === 'rec' ? 0.05 : 0) })
  }
  rows.sort((x, y) => y.score - x.score || x.n.length - y.n.length || (x.e.id < y.e.id ? -1 : 1))
  return { results: rows.slice(0, lim).map(r => ({ ...exOut(S, r.e, now), score: Math.round(r.score * 100) / 100 })), total: rows.length }
}

/* ------------------------------------------------------------------ state helpers */

const CFG = ['sets', 'reps', 'repsMin', 'repsMax', 'mode', 'sec', 'min', 'speed', 'weight', 'side', 'sg']
const routineOut = (S, r, now) => ({
  id: r.id, name: r.name, emoji: r.emoji || null,
  ex: (r.ex || []).map(c => {
    const e = lookup(S, c.id)
    const o = e ? exOut(S, e, now) : { id: c.id, name: 'Unknown exercise', equipment: '', target: '' }
    CFG.forEach(k => { if (c[k] != null) o[k] = c[k] })
    return o
  })
})
const weekOut = S => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, S.week?.[d] || null]))

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)   // same as lib/format.js

// Server time shifted to the user's timezone (S.reminder.tz), so pregnancy weeks flip at her
// local midnight even though the Edge runtime runs in UTC.
export function localNow(S, now = Date.now()) {
  const tz = S?.reminder?.tz
  if (!tz) return now
  try {
    const at = z => new Date(new Date(now).toLocaleString('en-US', { timeZone: z })).getTime()
    return now + at(tz) - at('UTC')
  } catch { return now }
}

const BUSY = 'Your openGym data changed on another device; please try again.'
// Read, change a copy, write with base = the _ts we read. On a 409 re-read and re-apply once.
async function change(ctx, fn) {
  for (let i = 0; ; i++) {
    const S = (await ctx.rpc('gym_get')) || {}
    for (const k of ['routines', 'customEx', 'workouts', 'bodyweight']) S[k] ||= []
    S.week ||= {}; S.dayPlan ||= {}
    const r = fn(S, localNow(S, ctx.now?.() ?? Date.now()))
    if (!r.write) return r.out
    try { await ctx.rpc('gym_put', { s: S, base: S._ts ?? null }); return r.out }
    catch (e) { if (e.status !== 409) throw e; if (i) fail(BUSY) }
  }
}
const read = async ctx => { const S = (await ctx.rpc('gym_get')) || {}; return { S, now: localNow(S, ctx.now?.() ?? Date.now()) } }

// The pregnancy guard: avoid ids the user has not confirmed one by one block the write.
function guard(S, ex, confirmed, now) {
  const warnings = []
  let block = false
  const seen = new Set()
  for (const c of ex) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    const lab = labelOf(c.id, S, now)
    if (lab !== 'avoid' && lab !== 'caution') continue
    const e = lookup(S, c.id)
    const w = { id: c.id, name: shown(e.n), label: lab, reason: reasonOf(c.id, S, now) }
    if (lab === 'avoid') {
      if ((confirmed || []).includes(c.id)) w.confirmed = true
      else {
        block = true
        w.swaps = search(S, { target: e.tg, pregnancy_safe: true, limit: 6 }, now).results.filter(x => x.label !== 'caution' && x.id !== c.id).slice(0, 2).map(x => ({ id: x.id, name: x.name }))
      }
    }
    warnings.push(w)
  }
  return { block, warnings }
}
const NEEDS = 'Ask the user whether to keep these (usually avoided in pregnancy) or swap them. Only if the user explicitly says keep, call again with confirm_avoid_ids listing each kept id.'

function checkIds(S, ex) {
  for (const c of ex) if (!lookup(S, c.id)) {
    throw Object.assign(new Error(`unknown_id ${c.id}`), { user: true, data: { error: 'unknown_id', id: c.id, message: 'Get exercise ids from search_exercises or get_routines; never guess ids.' } })
  }
}
const cfgOf = c => Object.fromEntries(CFG.filter(k => c[k] !== undefined).map(k => [k, c[k]]))

/* ------------------------------------------------------------------ tools */

const IDS = 'Always get exercise ids from search_exercises or get_routines; never guess ids.'
const PREG_NOTE = 'In pregnancy mode the user must confirm avoid exercises herself: if the result is needs_confirmation, ask her and only then retry with confirm_avoid_ids.'
const exInSchema = {
  type: 'object', additionalProperties: false, required: ['id', 'sets'],
  properties: {
    id: { type: 'string', description: 'Exercise id from search_exercises' }, sets: { type: 'integer', minimum: 1, maximum: 10 },
    reps: { type: 'integer', minimum: 1, maximum: 100 }, repsMin: { type: 'integer', minimum: 1, maximum: 100 }, repsMax: { type: 'integer', minimum: 1, maximum: 100 },
    mode: { enum: ['reps', 'time'] }, sec: { type: 'integer', minimum: 5, maximum: 3600 }, min: { type: 'number', minimum: 1, maximum: 300, description: 'Cardio minutes' },
    speed: { type: 'number', minimum: 0.5, maximum: 30 }, weight: { type: 'number', minimum: 0, maximum: 1000, description: "In the user's unit (see get_profile)" },
    side: { type: 'boolean', description: 'Reps counted per side' }, sg: { type: 'string', maxLength: 12, description: 'Same value on neighbouring exercises = superset' }
  }
}
const exArr = { type: 'array', minItems: 1, maxItems: 30, items: exInSchema }
const confirmArr = { type: 'array', items: { type: 'string' }, description: 'Avoid-in-pregnancy ids the user explicitly chose to keep' }
const noArgs = { type: 'object', properties: {}, additionalProperties: false }
const RO = { readOnlyHint: true, openWorldHint: false }
const W = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

export const TOOLS = [
  { name: 'get_profile', title: 'Get profile', annotations: RO, inputSchema: noArgs,
    description: "The user's openGym profile: name, sex, unit, experience, height, latest bodyweight and, if pregnant, the week, trimester and the kinds of exercise to avoid or treat with caution." },
  { name: 'search_exercises', title: 'Search exercises', annotations: RO,
    description: `Find exercises in the openGym library (and the user's custom ones). ${IDS} In pregnancy mode, avoid exercises are left out by default and others carry a label.`,
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      query: { type: 'string', description: 'Exercise name or words, e.g. "goblet squat"' },
      target: { type: 'string', description: 'Muscle or body part, e.g. glutes, lats, chest, cardio' },
      equipment: { type: 'array', items: { type: 'string' }, description: 'e.g. ["dumbbell","body weight","cable","band","barbell","kettlebell","leverage machine"]' },
      ids: { type: 'array', items: { type: 'string' }, description: 'Look up exactly these ids' },
      pregnancy_safe: { type: 'boolean', description: 'Default true when pregnant: leave out avoid exercises' },
      limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 } } } },
  { name: 'get_routines', title: 'Get routines', annotations: RO, inputSchema: noArgs,
    description: "The user's routines with their exercises and settings, and the week schedule (0=Sunday … 6=Saturday; null = rest)." },
  { name: 'get_recent_workouts', title: 'Get recent workouts', annotations: RO,
    description: 'Logged workouts from the last N days (default 28), newest first, at most 60.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { days: { type: 'integer', minimum: 1, maximum: 90, default: 28 } } } },
  { name: 'create_routine', title: 'Create routine', annotations: W,
    description: `Add a new routine. ${IDS} ${PREG_NOTE}`,
    inputSchema: { type: 'object', additionalProperties: false, required: ['name', 'ex'], properties: {
      name: { type: 'string', maxLength: 40 }, emoji: { type: 'string', maxLength: 8 }, ex: exArr, confirm_avoid_ids: confirmArr } } },
  { name: 'update_routine', title: 'Update routine', annotations: W,
    description: `Change a routine's name, emoji or exercises (ex replaces the whole list). ${IDS} ${PREG_NOTE}`,
    inputSchema: { type: 'object', additionalProperties: false, required: ['routine_id'], properties: {
      routine_id: { type: 'string' }, name: { type: 'string', maxLength: 40 }, emoji: { type: 'string', maxLength: 8 }, ex: exArr, confirm_avoid_ids: confirmArr } } },
  { name: 'set_week_schedule', title: 'Set week schedule', annotations: W,
    description: 'Set which routine is planned on which weekday. Keys "0" (Sunday) to "6" (Saturday); value a routine id or null for rest. Days not given stay as they are.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['week'], properties: {
      week: { type: 'object', additionalProperties: false, properties: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, { type: ['string', 'null'] }])) } } } },
  { name: 'delete_routine', title: 'Delete routine', annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Delete a routine. Logged workouts keep their history; days scheduled to it become rest days. Confirm with the user first.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['routine_id'], properties: { routine_id: { type: 'string' } } } }
]

const H = {
  async get_profile(ctx, a) {
    strict(a, {}, 'arguments')
    const { S, now } = await read(ctx)
    const p = S.profile || {}
    const bw = [...(S.bodyweight || [])].sort((x, y) => (x.d < y.d ? 1 : -1))[0]
    const pr = pregOf(S, now)
    let pregnancy = null
    if (pr) {
      // The kinds of move (rules) that carry each label this trimester, for this user.
      const by = { avoid: new Map(), caution: new Map() }
      for (const id of Object.keys(PREG)) {
        const lab = labelOf(id, S, now)
        if (by[lab]) { const rule = PREG[id].split(':')[0]; by[lab].set(rule, reasonOf(id, S, now)) }
      }
      const list = m => [...m].map(([rule, reason]) => ({ rule, reason }))
      pregnancy = { week: pr.week, day: pr.day, trimester: pr.tri, dueDate: pr.due, clearance: p.preg.clear || null, twins: p.preg.twins ?? null,
        avoid: list(by.avoid), caution: list(by.caution), guidance: 'Moderate effort (talk test, RPE 7 or less), no max lifts, no breath-holding. Prefer exercises labelled recommended.' }
    }
    return {
      name: p.name || null, sex: p.sex || null, unit: S.unit || 'kg', experience: p.exp || null, heightCm: p.heightCm ?? null,
      weekStart: S.weekStart ?? 1, latestBodyweight: bw ? { value: bw.w, date: bw.d } : null, pregnancy
    }
  },

  async search_exercises(ctx, a) {
    strict(a, { query: str(0, 100), target: str(0, 40), equipment: strList, ids: strList, pregnancy_safe: bool, limit: int(1, 25) }, 'arguments')
    const { S, now } = await read(ctx)
    return search(S, a, now)
  },

  async get_routines(ctx, a) {
    strict(a, {}, 'arguments')
    const { S, now } = await read(ctx)
    return { routines: (S.routines || []).map(r => routineOut(S, r, now)), week: weekOut(S) }
  },

  async get_recent_workouts(ctx, a) {
    strict(a, { days: int(1, 90) }, 'arguments')
    const { S, now } = await read(ctx)
    const since = new Date(now - (a.days ?? 28) * 864e5).toISOString().slice(0, 10)
    const workouts = (S.workouts || []).filter(w => (w.d || '') >= since).sort((x, y) => (x.d < y.d ? 1 : x.d > y.d ? -1 : (y.start || 0) - (x.start || 0))).slice(0, 60)
      .map(w => ({ date: w.d, routineName: w.name || null, entries: (w.entries || []).map(e => {
        const work = (e.sets || []).filter(s => s && s.done && s.tech !== 'warmup')
        const top = work.reduce((b, s) => ((s.w || 0) > (b?.w || 0) ? s : b), null)
        const o = { id: e.id, name: shown(lookup(S, e.id)?.n) || 'Unknown exercise', sets: work.length }
        if (top?.w) { o.topWeight = top.w; if (top.r != null) o.topReps = top.r }
        return o
      }) }))
    return { workouts, unit: S.unit || 'kg' }
  },

  async create_routine(ctx, a) {
    strict(a, { name: str(1, 40), emoji: str(1, 8), ex: exList, confirm_avoid_ids: strList }, 'arguments')
    if (!a.name || !a.ex) fail('name and ex are required')
    return change(ctx, (S, now) => {
      checkIds(S, a.ex)
      const g = guard(S, a.ex, a.confirm_avoid_ids, now)
      if (g.block) return { write: false, out: { status: 'needs_confirmation', warnings: g.warnings, message: NEEDS } }
      const r = { id: uid(), name: a.name.trim(), ...(a.emoji ? { emoji: a.emoji } : {}), ex: a.ex.map(c => ({ id: c.id, ...cfgOf(c) })) }
      S.routines.push(r)
      return { write: true, out: { status: 'created', routine_id: r.id, routine: routineOut(S, r, now), ...(g.warnings.length ? { warnings: g.warnings } : {}) } }
    })
  },

  async update_routine(ctx, a) {
    strict(a, { routine_id: str(1, 60), name: str(1, 40), emoji: str(0, 8), ex: exList, confirm_avoid_ids: strList }, 'arguments')
    if (!a.routine_id) fail('routine_id is required')
    return change(ctx, (S, now) => {
      const r = S.routines.find(x => x.id === a.routine_id)
      if (!r) fail(`No routine with id ${a.routine_id}; get ids from get_routines.`)
      let g = { warnings: [] }
      if (a.ex) {
        checkIds(S, a.ex)
        g = guard(S, a.ex, a.confirm_avoid_ids, now)
        if (g.block) return { write: false, out: { status: 'needs_confirmation', warnings: g.warnings, message: NEEDS } }
        r.ex = a.ex.map(c => ({ id: c.id, ...cfgOf(c) }))
      }
      if (a.name) r.name = a.name.trim()
      if (a.emoji !== undefined) { if (a.emoji) r.emoji = a.emoji; else delete r.emoji }
      return { write: true, out: { status: 'updated', routine_id: r.id, routine: routineOut(S, r, now), ...(g.warnings.length ? { warnings: g.warnings } : {}) } }
    })
  },

  async set_week_schedule(ctx, a) {
    strict(a, { week: v => strict(v, Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, (x, w) => { if (x !== null && typeof x !== 'string') fail(`${w} must be a routine id or null`) }])), 'week') }, 'arguments')
    if (!a.week) fail('week is required')
    return change(ctx, S => {
      for (const [d, id] of Object.entries(a.week)) {
        if (id === null) delete S.week[d]
        else if (!S.routines.some(r => r.id === id)) fail(`No routine with id ${id}; get ids from get_routines.`)
        else S.week[d] = id
      }
      return { write: true, out: { week: weekOut(S) } }
    })
  },

  async delete_routine(ctx, a) {
    strict(a, { routine_id: str(1, 60) }, 'arguments')
    if (!a.routine_id) fail('routine_id is required')
    return change(ctx, S => {
      const r = S.routines.find(x => x.id === a.routine_id)
      if (!r) fail(`No routine with id ${a.routine_id}; get ids from get_routines.`)
      // Same clean-up as the app's Delete routine button (views/RoutineEdit.jsx).
      S.routines = S.routines.filter(x => x.id !== r.id)
      Object.keys(S.week).forEach(k => { if (S.week[k] === r.id) delete S.week[k] })
      Object.keys(S.dayPlan).forEach(k => { if (S.dayPlan[k] === r.id) delete S.dayPlan[k] })
      return { write: true, out: { status: 'deleted', name: r.name } }
    })
  }
}

const summary = (name, o) => {
  if (o.status === 'needs_confirmation') return `Not saved. ${o.warnings.filter(w => w.label === 'avoid' && !w.confirmed).map(w => `${w.name}: ${w.reason}`).join(' ')} ${o.message}`
  if (o.status) return `${o.status[0].toUpperCase() + o.status.slice(1)} "${o.routine?.name || o.name}".${o.warnings?.length ? ' Notes: ' + o.warnings.map(w => `${w.name} (${w.label}): ${w.reason}`).join(' ') : ''}`
  return `${name} result: see the structured JSON.`
}

// One MCP tools/call: { content, structuredContent, isError? }.
export async function callTool(name, args, ctx) {
  const h = Object.hasOwn(H, name) && H[name]
  if (!h) return { isError: true, content: [{ type: 'text', text: `Unknown tool ${name}` }] }
  try {
    const out = await h(ctx, args ?? {})
    return { structuredContent: out, content: [{ type: 'text', text: summary(name, out) + '\n' + JSON.stringify(out) }] }
  } catch (e) {
    if (!e.user) throw e
    return { isError: true, structuredContent: e.data || { error: e.message }, content: [{ type: 'text', text: e.data ? `${e.data.error} ${e.data.id}: ${e.data.message}` : e.message }] }
  }
}

export const PROMPTS = [{ name: 'build_plan', title: 'Build my openGym plan', description: 'Plan workouts with the user and save them as openGym routines.' }]
export const buildPlanPrompt = () => ({
  description: PROMPTS[0].description,
  messages: [{ role: 'user', content: { type: 'text', text: [
    'Help me plan my workouts in openGym. First call get_profile and get_routines, and look at get_recent_workouts.',
    'Ask me short questions if something important is missing (days per week, session length, equipment, injuries), then propose a plan.',
    'Use search_exercises to find every exercise; always use ids it returns, never guess ids.',
    'When I am happy, save it with create_routine or update_routine, then set_week_schedule.',
    'If I am pregnant: never pick avoid exercises yourself, prefer recommended ones, keep effort moderate (talk test, RPE 7 or less, no max lifts, no breath-holding).',
    'If a save comes back needs_confirmation, tell me why and offer the swaps; only keep an exercise if I say so.'
  ].join('\n') } }]
})
