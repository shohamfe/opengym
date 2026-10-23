// "Build with AI", copy-prompt path (ai-options.md, 2026-10-23 spec S1-S2).
//
//  1. buildPrompt(S)      → an English prompt the user pastes into their own AI chat. It
//                           carries a filtered exercise list so the AI answers with real ids.
//  2. extractPlan(text)   → finds the plan JSON in whatever the user pastes back (prose,
//                           code fences, trailing commas, a reply that got cut off).
//  3. matchExercises(p,S) → checks every exercise's id AND name against the library. Nothing
//                           is ever dropped silently: an exercise is either confirmed here or
//                           shown on the review screen, where only an explicit tap skips it.
//  4. toBundle(m, res)    → the plan-share bundle that the existing additive mergePlan takes.

import { EXDB, EXIDX } from './exercises.js'
import { defaultConfig, modeOf, lastBW } from './history.js'
import { KG_PER_LB } from './units.js'
import { LANGS } from './i18n.js'
import { pregOf, labelOf, reasonOf } from './pregnancy.js'

/* ------------------------------- names ------------------------------- */

// Normalised name used for every comparison (spec S1.2).
export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\((?:fe)?male\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:v|version) (\d+)\b/g, 'v$1')
    .split(' ').filter(Boolean)
    // >= 3, not the spec's > 3: "push-ups" has to meet "push-up" ("ups" → "up").
    .map(w => (w.length >= 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ')
}

// Gym words AIs use that the library names differently. shortcut: hand-curated, grow it from
// the names that keep landing on the review screen.
const ALIASES_RAW = {
  'bench press': '0025', 'flat bench press': '0025', 'barbell bench': '0025',
  'rdl': '0085', 'romanian deadlift': '0085', 'dumbbell rdl': '1459',
  'deadlift': '0032', 'sumo deadlift': '0117',
  'squat': '0043', 'back squat': '0043', 'barbell squat': '0043', 'barbell back squat': '0043', 'front squat': '0042',
  'goblet squat': '0534',
  'lat pulldown': '0198', 'pulldown': '0198', 'wide grip lat pulldown': '0150',
  'seated cable row': '0861', 'cable row': '0861', 'seated row': '0861',
  'dumbbell row': '0293', 'bent over row': '0027', 'barbell row': '0027',
  'hip thrust': '1409', 'barbell hip thrust': '1409', 'glute bridge': '3013',
  'pallof press': '0979',
  'push up': '0662', 'pushup': '0662', 'pull up': '0652', 'pullup': '0652', 'chin up': '1326', 'chinup': '1326',
  'dip': '0251', 'dips': '0251',
  'overhead press': '0091', 'ohp': '0091', 'shoulder press': '0405', 'dumbbell shoulder press': '0405',
  'military press': '1457',
  'bicep curl': '0294', 'biceps curl': '0294', 'dumbbell curl': '0294',
  'tricep pushdown': '0201', 'triceps pushdown': '0201',
  'leg curl': '0586', 'hamstring curl': '0586', 'lying leg curl': '0586',
  'calf raise': '1373', 'standing calf raise': '1373',
  'lunge': '0336', 'step up': '0431',
  'farmer walk': '2133', 'farmers carry': '2133', 'farmer carry': '2133',
  'treadmill walk': '3666', 'incline walk': '3666', 'walking': '3666',
  'stationary bike': '2138', 'bike': '2138', 'cycling': '2138', 'elliptical': '2141',
  'side plank': '3544', 'back extension': '0489', 'reverse fly': '0383', 'rear delt fly': '0383'
}
// Only aliases whose id exists, so a dataset change can't route a name to a blank row.
const ALIASES = Object.fromEntries(Object.entries(ALIASES_RAW).filter(([, id]) => EXIDX[id]).map(([k, id]) => [norm(k), id]))

let NAME_IDX = null
function nameIndex() {
  if (!NAME_IDX) {
    NAME_IDX = new Map()
    // EXDB already leaves out the female picture variants (lib/exercises.js)
    EXDB.forEach(e => { const k = norm(e.n); NAME_IDX.set(k, [...(NAME_IDX.get(k) || []), e.id]) })
  }
  return NAME_IDX
}
const customs = S => (S && S.customEx) || []
const byId = (id, S) => customs(S).find(c => c.id === id) || EXIDX[id]

// Ids whose normalised name equals k: your customs first, then the library (lowest id
// first for the few duplicated names), then the alias table.
function byName(k, S) {
  if (!k) return []
  const c = customs(S).filter(x => norm(x.n) === k).map(x => x.id)
  const b = [...(nameIndex().get(k) || [])].sort()
  return [...new Set([...c, ...b, ...(ALIASES[k] ? [ALIASES[k]] : [])])]
}

const tokens = s => new Set(s.split(' ').filter(Boolean))
export function jaccard(a, b) {
  const A = tokens(a), B = tokens(b)
  if (!A.size && !B.size) return 1
  let i = 0
  A.forEach(x => { if (B.has(x)) i++ })
  return i / (A.size + B.size - i)
}
function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}
// Top 3 library/custom ids for a name nothing matched exactly (spec matching row 5).
export function fuzzy(k, S, n = 3) {
  if (!k) return []
  return [...customs(S), ...EXDB]
    .map(e => {
      const en = norm(e.n)
      const eq = e.eq && e.eq !== 'custom' ? norm(e.eq) : ''
      const score = 0.6 * jaccard(k, en) + 0.4 * (1 - lev(k, en) / Math.max(k.length, en.length, 1)) +
        (eq && (' ' + k + ' ').includes(' ' + eq + ' ') ? 0.1 : 0)
      return { id: e.id, score }
    })
    .filter(x => x.score >= 0.45)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    .slice(0, n).map(x => x.id)
}

/* ------------------------------- matching ------------------------------- */

// One exercise → { status: ok|review|unmatched|avoid, how, pick, sugg, reason }.
export function matchOne(ai, S) {
  let id = ai.id == null || ai.id === '' ? null : String(ai.id).trim()
  if (id && /^\d{1,3}$/.test(id)) id = id.padStart(4, '0')   // the AI wrote 47 for "0047"
  const k = norm(ai.name)
  const ex = id ? byId(id, S) : null
  let r
  if (ex && k && (norm(ex.n) === k || jaccard(norm(ex.n), k) >= 0.8)) r = { status: 'ok', how: 'exact', pick: ex.id, sugg: [] }
  else {
    const hits = byName(k, S)
    if (ex) {
      // A real id for a different exercise: models get ids wrong more often than names,
      // so the name's match is offered first.
      const best = hits[0] || fuzzy(k, S, 1)[0]
      r = { status: 'review', how: 'mismatch', pick: null, sugg: [...new Set([best, ex.id].filter(Boolean))] }
    } else if (hits.length) r = { status: 'ok', how: 'name', pick: hits[0], sugg: [] }
    else r = { status: 'unmatched', how: 'fuzzy', pick: null, sugg: fuzzy(k, S) }
  }
  if (r.pick && labelOf(r.pick, S) === 'avoid') return { ...r, status: 'avoid', reason: reasonOf(r.pick, S) }
  return r
}

const LIMITS = {   // [min, max, integer] per the import schema
  sets: [1, 10, 1], reps: [1, 100, 1], repsMin: [1, 100, 1], repsMax: [1, 100, 1],
  sec: [5, 3600, 1], min: [1, 300, 0], speed: [0.5, 30, 0], weight: [0, 1000, 0]
}
// Numbers in, clamped. Fields the AI must not set (prog, inc, bodyweight) never get through.
function cleanCfg(e, w, f) {
  const range = typeof e.reps === 'string' && e.reps.match(/(\d+)\s*(?:-|–|—|to)\s*(\d+)/)
  const src = range ? { ...e, repsMin: +range[1], repsMax: +range[2], reps: +range[2] } : e
  const o = {}
  Object.entries(LIMITS).forEach(([k, [lo, hi, int]]) => {
    if (src[k] == null || src[k] === '') return
    let v = Number(src[k])
    if (!Number.isFinite(v)) { w.clamped++; return }
    if (int) v = Math.round(v)
    const c = Math.min(hi, Math.max(lo, v))
    if (c !== v) w.clamped++
    o[k] = c
  })
  if (o.weight && f !== 1) o.weight = Math.max(0.5, Math.round(o.weight * f / 0.5) * 0.5)
  if (e.mode === 'reps' || e.mode === 'time') o.mode = e.mode
  if (e.side === true) o.side = true
  if (typeof e.sg === 'string' && e.sg) o.sg = e.sg.slice(0, 12)
  return o
}

// The routine config for a chosen exercise: today's editor defaults, overlaid with the AI's
// numbers. `perSide`: the AI was told one-sided reps are per side; the app stores the total.
export function cfgFor(id, raw, perSide) {
  const mode = modeOf({ id }) === 'cardio' ? 'cardio'
    : raw.mode || (raw.sec != null && raw.reps == null ? 'time' : 'reps')
  const o = { id, ...defaultConfig(id, mode) }
  const keys = mode === 'cardio' ? ['sets', 'min', 'speed'] : mode === 'time' ? ['sets', 'sec', 'weight'] : ['sets', 'reps', 'repsMin', 'repsMax', 'weight']
  keys.forEach(k => { if (raw[k] != null) o[k] = raw[k] })
  if (mode === 'reps') {
    if (raw.side) o.side = true
    if (o.side && perSide) ['reps', 'repsMin', 'repsMax'].forEach(k => { if (raw[k] != null) o[k] = raw[k] * 2 })
  }
  if (raw.sg) o.sg = raw.sg
  return o
}

/**
 * Check a parsed plan against the library. Returns
 *   { name, unit, perSide, week, warnings, routines: [{ id, name, emoji, rows: [row] }] }
 * where each row is { ai: {id, name}, raw, status, how, pick, sugg, reason? }.
 */
export function matchExercises(plan, S) {
  const warnings = []
  const unit = S.unit || 'kg'
  const from = plan.unit === 'kg' || plan.unit === 'lb' ? plan.unit : unit
  const f = from === unit ? 1 : unit === 'lb' ? 1 / KG_PER_LB : KG_PER_LB
  if (f !== 1) warnings.push({ k: 'unit', from, to: unit })
  let rs = (Array.isArray(plan.routines) ? plan.routines : []).filter(r => r && typeof r === 'object')
  if (rs.length > 14) { warnings.push({ k: 'routines', n: rs.length }); rs = rs.slice(0, 14) }
  const mine = new Set((S.routines || []).map(r => (r.name || '').trim().toLowerCase()))
  const seen = new Set()
  const w = { clamped: 0 }
  let cut = 0
  const routines = rs.map((r, i) => {
    let ex = Array.isArray(r.ex) ? r.ex : []
    if (ex.length > 30) { cut++; ex = ex.slice(0, 30) }
    let id = r.id != null && r.id !== '' ? String(r.id) : 'R' + (i + 1)
    if (seen.has(id)) id = id + '·' + (i + 1)
    seen.add(id)
    let name = (typeof r.name === 'string' ? r.name.trim() : '').slice(0, 40)
    if (name && mine.has(name.toLowerCase())) name = name.slice(0, 35) + ' (AI)'
    const rows = ex.map(e => (typeof e === 'string' ? { name: e } : e)).filter(e => e && typeof e === 'object').map(e => {
      const ai = { id: e.id ?? null, name: typeof e.name === 'string' ? e.name.trim().slice(0, 80) : '' }
      return { ai, raw: cleanCfg(e, w, f), ...matchOne(ai, S) }
    })
    return { id, name, emoji: typeof r.emoji === 'string' ? r.emoji.slice(0, 8) : undefined, rows }
  })
  if (cut) warnings.push({ k: 'exercises', n: cut })
  if (w.clamped) warnings.push({ k: 'clamped', n: w.clamped })
  const ids = new Set(routines.map(r => r.id))
  const week = {}
  let bad = 0
  Object.entries(plan.week && typeof plan.week === 'object' ? plan.week : {}).forEach(([d, v]) => {
    if (!/^[0-6]$/.test(d) || v == null || v === '') return
    if (ids.has(String(v))) week[d] = String(v); else bad++
  })
  if (bad) warnings.push({ k: 'week', n: bad })
  return { name: typeof plan.name === 'string' ? plan.name.trim().slice(0, 60) : '', unit: from, perSide: plan.source === 'ai', week, warnings, routines }
}

/* ------------------------------- review state ------------------------------- */
// res: { 'routineIndex:rowIndex': { id, keep? } | 'skip' }. Missing = still unresolved.
export const rowKey = (ri, xi) => ri + ':' + xi

export function initialRes(m) {
  const res = {}
  m.routines.forEach((r, ri) => r.rows.forEach((row, xi) => { if (row.pick) res[rowKey(ri, xi)] = { id: row.pick } }))
  return res
}
// Still needs a tap: no exercise chosen yet, or one usually avoided now that wasn't kept.
export const isOpen = (v, S) => !v || (v !== 'skip' && labelOf(v.id, S) === 'avoid' && !v.keep)
export const openCount = (m, res, S) =>
  m.routines.reduce((n, r, ri) => n + r.rows.filter((_, xi) => isOpen(res[rowKey(ri, xi)], S)).length, 0)

export function toBundle(m, res) {
  const routines = m.routines.map((r, ri) => ({
    id: r.id, name: r.name, emoji: r.emoji,
    ex: r.rows.flatMap((row, xi) => {
      const v = res[rowKey(ri, xi)]
      return v && v !== 'skip' && v.id ? [cfgFor(v.id, row.raw, m.perSide)] : []
    })
  }))
  return {
    name: m.name, routines, week: m.week, customEx: [],
    routineCount: routines.length,
    exerciseCount: routines.reduce((n, r) => n + r.ex.length, 0),
    scheduledDays: Object.keys(m.week).length
  }
}

/* ------------------------------- paste extraction ------------------------------- */

// End of the {...} starting at i, skipping braces inside strings; -1 when it never closes.
function closeOf(s, i) {
  let d = 0, q = false
  for (let j = i; j < s.length; j++) {
    const c = s[j]
    if (q) { if (c === '\\') j++; else if (c === '"') q = false }
    else if (c === '"') q = true
    else if (c === '{') d++
    else if (c === '}' && --d === 0) return j
  }
  return -1
}
// The two usual AI slips, removed outside strings: // comments and trailing commas.
function lenient(s) {
  let o = '', q = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) { o += c; if (c === '\\') o += s[++i] ?? ''; else if (c === '"') q = false; continue }
    if (c === '"') { q = true; o += c; continue }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; o += '\n'; continue }
    if (c === ',' && /^\s*[}\]]/.test(s.slice(i + 1, i + 200))) continue
    o += c
  }
  return o
}
function tryParse(s) {
  for (const x of [s, () => lenient(s), () => lenient(s.replace(/[“”]/g, '"'))]) {
    try { return JSON.parse(typeof x === 'function' ? x() : x) } catch (e) { /* next */ }
  }
  return undefined
}
const isPlan = o => !!o && typeof o === 'object' && !Array.isArray(o) && (!!o.opengym_plan || Array.isArray(o.routines))

/**
 * Find the plan in pasted text. → { plan, count } | { error: 'none' | 'cutoff' | 'empty' }.
 * Several plans (the AI printed a draft first) → the last one; `count` says how many.
 */
export function extractPlan(text) {
  const s = String(text || '').replace(/[​-‍⁠﻿]/g, '')
  const cands = []
  const fence = /```[a-zA-Z]*[^\S\n]*\n?([\s\S]*?)```/g
  let m
  while ((m = fence.exec(s))) cands.push(m[1])
  let cut = false
  for (let i = s.indexOf('{'); i >= 0; i = s.indexOf('{', i + 1)) {
    const end = closeOf(s, i)
    if (end < 0) { cut = true; break }
    cands.push(s.slice(i, end + 1))
    i = end
  }
  const found = []
  const keys = new Set()
  cands.forEach(c => {
    const o = tryParse(c.trim())
    if (!isPlan(o)) return
    const k = JSON.stringify(o)
    if (!keys.has(k)) { keys.add(k); found.push(o) }
  })
  if (!found.length) return { error: cut ? 'cutoff' : 'none' }
  const plan = found[found.length - 1]
  if (!Array.isArray(plan.routines) || !plan.routines.length) return { error: 'empty' }
  return { plan, count: found.length }
}

/* ------------------------------- prompt ------------------------------- */

const EXP = { regular: 'Experienced (I train regularly)', some: 'Some (less than a year, or on and off)', none: 'New to strength training' }
const SEX = { female: 'female', male: 'male', na: 'prefer not to say' }

function scheme(e, unit) {
  const mode = modeOf(e)
  if (mode === 'cardio') return `${e.min || 20} min`
  const s = `${e.sets || 3}x${mode === 'time' ? (e.sec || 45) + 's' : e.reps ?? 10}`
  return e.weight ? `${s} @ ${e.weight} ${unit}` : s
}

// Exercise list grouped by target muscle, recommended first then shortest name (the
// canonical variant). Recommended lines and exercises already in your routines always stay.
export function catalogue(S, cap, preg) {
  const keep = new Set((S.routines || []).flatMap(r => (r.ex || []).map(e => e.id)))
  const groups = {}
  EXDB.forEach(e => {
    const lab = preg ? labelOf(e.id, S) : null
    if (lab === 'avoid' && !keep.has(e.id)) return
    const g = e.tg || e.bp
    ;(groups[g] = groups[g] || []).push({ e, rec: lab === 'rec', keep: keep.has(e.id) })
  })
  return Object.keys(groups).sort().map(g => {
    const list = groups[g].sort((a, b) => b.rec - a.rec || a.e.n.length - b.e.n.length || (a.e.n < b.e.n ? -1 : 1))
    return '# ' + g + '\n' + list.filter((x, i) => x.rec || x.keep || i < cap)
      .map(x => `${x.e.id}|${x.e.n}|${x.e.eq}${x.rec ? ' [R]' : ''}`).join('\n')
  }).join('\n')
}

function assemble(S, { lang, preg, goal }, cap) {
  const unit = S.unit || 'kg'
  const p = S.profile || {}
  const bw = lastBW(S)
  const h = p.heightCm ? (unit === 'lb' ? `${Math.round(p.heightCm / 2.54)} in` : `${p.heightCm} cm`) : 'unknown'
  const L = [
    `You are helping me plan my workouts for the openGym app. Talk with me in ${LANGS[lang] || 'English'}.`,
    'Ask me short questions if anything important is missing, then propose a plan. When I say',
    'I\'m happy, reply with ONE json code block in the exact format at the end — nothing else',
    'inside the block.',
    '',
    'ABOUT ME',
    `- Sex: ${SEX[p.sex] || 'unknown'}. Height: ${h}. Weight: ${bw ? bw.w + ' ' + unit : 'unknown'}.`,
    `- Experience${preg ? ' before pregnancy' : ''}: ${EXP[p.exp] || 'unknown'}. Goal: ${goal || 'ask me'}.`,
    '- Days per week I can train: ask me. Session length: ask me.',
    '- Equipment I have: a normal gym (ask me if unsure).',
    '- Injuries / limits: ask me.'
  ]
  if (preg) {
    const avoid = [...new Set(EXDB.filter(e => labelOf(e.id, S) === 'avoid').map(e => reasonOf(e.id, S)).filter(Boolean))]
    const clear = p.preg?.clear
    L.push(
      `- I am PREGNANT: week ${preg.week} (trimester ${preg.tri}), due ${preg.due}.` +
        (clear === 'yes' ? ' My doctor/midwife cleared me to exercise.'
          : clear === 'limits' ? ' My doctor/midwife set some limits: ask me what they are and respect them.'
            : ' My doctor/midwife has not cleared me yet: keep everything gentle (walking, mobility, light bands).'),
      '  Rules for you:',
      ...(avoid.length ? [`  * NEVER use these (avoid): ${avoid.join('; ')}.`] : []),
      '  * Never use exercises that are not in the list below (usually-avoided ones are left out).',
      '  * Prefer exercises marked [R] in the list. Use moderate effort (talk test, RPE ≤ 7),',
      '    no max lifts, no breath-holding.',
      '  * If I ask for something that is usually avoided in pregnancy, tell me why and suggest a swap.'
    )
  }
  const routines = (S.routines || []).filter(r => r.ex && r.ex.length)
  L.push('', 'MY CURRENT ROUTINES (for reference; you may keep, change or replace them)')
  if (routines.length) routines.forEach(r => L.push(`- ${r.name}: ` + r.ex.map(e => `${byId(e.id, S)?.n || 'unknown exercise'} ${scheme(e, unit)}`).join('; ')))
  else L.push('none yet')
  L.push(
    '',
    'EXERCISE LIST — use ONLY these ids, copy id AND name exactly.',
    `Format: id|name|equipment.${preg ? ' [R] = recommended for me.' : ''}`,
    catalogue(S, cap, preg),
    'If you really need an exercise that is not listed, use "id": null and give its usual',
    'English name; the app will let me pick the closest one.',
    '',
    `OUTPUT FORMAT (weights in ${unit}; omit fields you don't use; for one-arm or one-leg`,
    'exercises "reps" is per side; timed holds use "mode": "time" and "sec"; cardio uses "min"):',
    '```json',
    JSON.stringify({
      opengym_plan: 1, source: 'ai', unit, name: 'short plan name',
      routines: [{
        id: 'A', name: 'Full body A', emoji: '💪', ex: [
          { id: '0047', name: 'barbell incline bench press', sets: 3, reps: 10, weight: 30 },
          { id: 'xxxx', name: '…', sets: 3, mode: 'time', sec: 30 },
          { id: 'xxxx', name: '…', sets: 1, min: 20, speed: 6 }
        ]
      }],
      week: { 1: 'A', 3: 'B', 5: 'A' }
    }, null, 2),
    '```',
    'week keys: 0=Sunday … 6=Saturday; values are routine ids from "routines".'
  )
  return L.join('\n')
}

/**
 * The prompt the user copies into their AI. opts: { lang, noPreg, goal, now }.
 * noPreg leaves the pregnancy block (and the [R]/avoid filtering that would hint at it) out.
 * Over about 9k tokens (chars ÷ 3.3) the per-muscle cap drops from 20 to 12.
 */
export function buildPrompt(S, opts = {}) {
  const o = { lang: opts.lang || 'en', goal: opts.goal, preg: opts.noPreg ? null : pregOf(S, opts.now ?? Date.now()) }
  const p = assemble(S, o, 20)
  return p.length / 3.3 > 9000 ? assemble(S, o, 12) : p
}
