import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI, armStale, cancelStale } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { effectiveRoutine, lastEntryFor, lastLine, bestWeightFor, buildSets, supersetUnits, swapConfig, unitOf, setLabel, modeOf, isBw, isPerSide, sideReps, repStep, EFFORT, effortOf, stepEffort, capEffort } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, exCount, DAYN } from '../lib/format.js'
import { play, vibrate } from '../lib/sound.js'
import confetti from 'canvas-confetti'
import setDoneSnd from '../assets/sounds/set-done.mp3'
import exDoneSnd from '../assets/sounds/exercise-done.mp3'
import { t } from '../lib/i18n.js'
import Media from '../components/Media.jsx'
import { startFlow, exercisePicker, exConfigSheet, exerciseDetailSheet, finishWorkout, confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Check, NumberField } from '../components/ui.jsx'
import { nextPrescription, applyPrescription } from '../lib/progression.js'
import { glyphOf } from '../lib/glyphs.js'
import { TECH, TECH_IDS, PARTS_TECH, MAX_PARTS, techBadge, techName, techDesc, nextPart, nextPartW } from '../lib/tech.js'

/* ---------- set-type picker: tech, partials, and (re)seeding the parts rows ---------- */
function TechSheet({ entryIdx, i, close }) {
  const update = useStore(s => s.update)
  const entry = useStore(s => s.S.active?.entries[entryIdx])
  const s = entry?.sets[i]
  if (!s) return null
  const ex = exOr(entry.id)
  const cur = s.tech || null
  const num = entry.sets.slice(0, i).filter(x => x.tech !== 'warmup').length + 1
  const mut = fn => update(S => { fn(S.active.entries[entryIdx].sets[i]) }, true)
  const pick = id => {
    if (id === cur) return close()
    const filled = (s.parts || []).filter(p => p && p.r > 0).length
    const apply = () => {
      mut(x => {
        if (id) x.tech = id; else delete x.tech
        if (id === 'warmup') delete x.partials
        if (!PARTS_TECH.includes(id)) delete x.parts
        else if (!(x.parts && x.parts.length)) x.parts = [nextPart(x)]
      })
      close()
    }
    if (!PARTS_TECH.includes(id) && filled) confirmSheet({
      title: t(filled === 1 ? 'Remove 1 extra part?' : 'Remove {0} extra parts?', filled),
      message: t('Switching to {0} deletes the extra parts on this set.', id ? techName(id) : t('Normal')),
      confirmText: t('Remove parts'), danger: true, onConfirm: apply })
    else apply()
  }
  const setPartials = n => mut(x => { if (n > 0) x.partials = n; else delete x.partials })
  const np = s.partials || 0
  return <>
    <h3>{t('Set type')}</h3>
    <div className="muted small" style={{ marginBottom: 12, textTransform: 'capitalize' }}>{ex.n} · {t('set {0}', num)}</div>
    <div className="sect-b tsheet" role="radiogroup" aria-label={t('Set type')}>
      {[null, ...TECH_IDS].map(id => <button key={id || 'none'} className="lrow tap" role="radio" aria-checked={cur === id} onClick={() => pick(id)}>
        <span className={'tb-i' + (id === 'warmup' ? ' w' : id ? ' t' : '')}>{id ? TECH[id].b : num}</span>
        <span className="lrow-m"><span className="lrow-t">{id ? techName(id) : t('Normal')}</span>
          <span className="lrow-s">{id ? techDesc(id) : t('A regular counted set.')}</span></span>
        {cur === id && <Icon name="check" className="lrow-k" />}
      </button>)}
    </div>
    {cur !== 'warmup' && <div className="sect-b" style={{ marginTop: 12 }}>
      <div className="lrow"><span className="lrow-m"><span className="lrow-t">{t('Partial reps')}</span>
        <span className="lrow-s">{t('Extra half-reps at the stretched end.')}</span></span>
        <div className="stp tsheet-stp">
          <button aria-label={t('Decrease {0}', t('Partial reps'))} onClick={() => setPartials(Math.max(0, np - 1))}><Icon name="minus" /></button>
          <span className="val"><NumberField decimal={false} value={np} onChange={setPartials} /></span>
          <button aria-label={t('Increase {0}', t('Partial reps'))} onClick={() => setPartials(np + 1)}><Icon name="plus" /></button>
        </div></div></div>}
  </>
}

// Read-only: every working set from last session, the detail the one-line summary leaves out.
const lastTimeSheet = (id, last) => useUI.getState().openSheet(() => <>
  <h3>{t('Last time')}</h3>
  <div className="muted small" style={{ marginBottom: 12 }}>{fmtDate(last.d, true)}</div>
  <div className="sect-b">{last.sets.map((s, i) => <div key={i} className="lrow">
    <span className="tb-i">{i + 1}</span><span className="lrow-m"><span className="lrow-t">{setLabel(id, s, last.target, { effort: false })}</span></span>
    {(s.rir ?? s.rpe) != null && <span className="effpill" style={{ flex: 'none' }}>{EFFORT[s.rir != null ? 'rir' : 'rpe'].hd} {fmtNum(s.rir ?? s.rpe)}</span>}
  </div>)}</div>
</>, { label: t('Last time') })

/* ---------- start chooser (no active workout) ---------- */
function StartChooser() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const todayR = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const others = S.routines.filter(r => r !== todayR)
  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Start workout')}</h1><div className="sub">{t(DAYN[new Date().getDay()])} — {todayR ? t('today is {0}', todayR.name) : t('rest day, but no one’s stopping you')}</div></div></div>
    {todayR && <div className="card" style={{ boxShadow: 'inset 0 0 0 1.5px var(--acc)' }}>
      <h2 className="accent">{t("Today's plan")}{todayOvr ? ' · ' + t('rescheduled') : ''}</h2>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div><div className="big">{todayR.name}</div><div className="muted small">{exCount(todayR.ex.length)}</div></div>
        <span className="lrow-i" style={{ width: 38, height: 38, borderRadius: 9, fontSize: 22 }}><Icon name={glyphOf(todayR.emoji)} /></span>
      </div>
      <Button variant="primary" icon="play" onClick={() => startFlow(todayR.id)}>{t('Start {0}', todayR.name)}</Button>
    </div>}
    {others.length > 0 && <><h4 className="sec">{t('Other routines')}</h4>
      <div className="list">{others.map(r => <div key={r.id} className="item" onClick={() => startFlow(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <span className="tag acc">{t('Start')}</span></div>)}</div></>}
    <div style={{ height: 14 }} />
    <Button icon="shuffle" onClick={() => startFlow(null)}>{t('Freestyle workout (pick as you go)')}</Button>
    {!S.routines.length && <><div style={{ height: 10 }} /><Button variant="primary" onClick={() => nav('/plan')}>{t('Build a plan first')}</Button></>}
  </div>
}

/* ---------- elapsed clock (isolated so the workout tree doesn't re-render every second) ---------- */
function Elapsed({ start }) {
  const [t, setT] = useState('0:00')
  useEffect(() => {
    const tick = () => { const s = Math.floor((Date.now() - start) / 1000); setT(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) }
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv)
  }, [start])
  return <span>{t}</span>
}

/* ---------- one exercise block (reps: weight×reps · time: a held duration · cardio: duration+speed) ---------- */
function ExerciseBlock({ entryIdx, compact, hint, onToggle, onField, onPart, onAddPart, onRemovePart, onAddSet, onRemoveSet, onStartTimed, onSwap }) {
  const S = useStore(s => s.S)
  const working = useUI(s => s.work)
  const entry = S.active.entries[entryIdx]
  const ex = exOr(entry.id)
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const cardio = mode === 'cardio'
  const timed = mode === 'time'
  const last = lastEntryFor(S, entry.id)
  // The same number the "confirm your working weight" sheet calls your best, so the two
  // never disagree inside one session: heaviest logged set, or the working weight you kept.
  const best = cardio ? 0 : Math.max(bestWeightFor(S, entry.id), (S.exWeights[entry.id] || {}).w || 0)
  // What the progression policy decided for this session, and why (issue #17). Computed when
  // the session was built so the reason matches the numbers already in the rows.
  const plan = entry.plan
  const nextIdx = entry.sets.findIndex(s => !s.done)   // the set you're about to do gets the outline
  // A bodyweight set has no weight to type, so the column is not there (issue #32) — one
  // stepper instead of two, which is the whole point of the flag. Adding a belt weight in the
  // config brings it back, now labelled as the addition it is.
  const cfg = { ...(entry.target || {}), id: entry.id }
  const bw = !cardio && isBw(cfg)
  const added = bw && entry.sets.some(s => s.w > 0)
  const loadCol = { f: 'w', step: 2.5, dec: true, hd: bw ? t('Added ({0})', S.unit) : t('Weight ({0})', S.unit) }
  // The reps column is the total in every mode, unilateral included — the stepper walks in
  // twos there so the number you land on is one you can actually split evenly.
  const repCol = { f: 'r', step: repStep(cfg), dec: false, hd: t('Reps') }
  const col1 = cardio ? { f: 'min', step: 1, dec: false, hd: t('Duration (min)') }
    : timed ? { f: 'sec', step: 5, dec: false, hd: t('Seconds') }
      : (bw && !added) ? repCol : loadCol
  const col2 = cardio ? { f: 'speed', step: 0.5, dec: true, hd: t('Speed (km/h)') }
    : timed ? ((bw && !added) ? null : loadCol)
      : (bw && !added) ? null : repCol
  // Effort (RIR or RPE, whichever the profile logs) only makes sense for weighted rep sets,
  // not cardio/timed holds, and is opt-in since it adds a third stepper to every row. `opt`
  // because an unlogged effort is not the same as 0 — RIR 0 says the set went to failure.
  const kind = effortOf(S)
  const eff = EFFORT[kind]
  const col3 = mode === 'reps' && eff ? { ...eff, eff: kind, dec: true, opt: true, hd: t(eff.hd) } : null
  // Effort is judged after the set, so it is asked for there: a chip row under the set you just
  // finished, instead of a third stepper squeezing weight and reps on every row (round 2).
  const [pick, setPick] = useState(null)
  // warm-ups and failure sets never ask: the tag already says it
  const noEff = x => x.tech === 'warmup' || x.tech === 'fail'
  const lastDone = entry.sets.reduce((k, x, i) => (x.done && !noEff(x) ? i : k), -1)
  // unticking a set closes its chips: effort only belongs to a done set
  const effOpen = !col3 ? -1 : pick != null && entry.sets[pick]?.done && !noEff(entry.sets[pick]) ? pick : (lastDone >= 0 && entry.sets[lastDone][col3.f] == null ? lastDone : -1)
  const chips = kind === 'rpe' ? [6, 7, 8, 9, 10] : [0, 1, 2, 3, 4]
  const chipLabel = v => kind === 'rpe' ? (v === 6 ? '≤6' : String(v)) : (v === 4 ? '4+' : String(v))
  // The effort column walks its own scale — see stepEffort. Weight and reps step up from 0
  // with no ceiling, as they always did.
  const bump = (s, i, col, dir, j) => {
    if (j != null) return onPart(i, j, col.f, Math.max(0, Math.round(((s.parts[j][col.f] || 0) + dir * col.step) * 100) / 100))
    if (col.eff) return onField(i, col.f, stepEffort(col.eff, s[col.f], dir))
    onField(i, col.f, Math.max(0, Math.round(((s[col.f] || 0) + dir * col.step) * 100) / 100))
  }
  // Uses the shared stepper markup so a set row picks up the same control styling
  // as every other +/- field in the app.
  // j given: the cell edits parts[j] (extra drop / mini-set) instead of the set itself.
  const cell = (s, i, col, cls, j) => (
    <div className={'stp ' + cls}>
      <button aria-label={t('Decrease {0}', col.hd)} onClick={() => bump(s, i, col, -1, j)}><Icon name="minus" /></button>
      {/* a typed effort is capped — there is no RPE 12, and 12 reps in reserve is a warm-up */}
      <span className="val"><NumberField decimal={col.dec} nullable={col.opt} value={(j == null ? s : s.parts[j])[col.f] ?? ''}
        onChange={v => j == null ? onField(i, col.f, col.eff ? capEffort(col.eff, v) : v) : onPart(i, j, col.f, v)} /></span>
      <button aria-label={t('Increase {0}', col.hd)} onClick={() => bump(s, i, col, 1, j)}><Icon name="plus" /></button>
    </div>
  )
  const repsMode = mode === 'reps'
  // working numbers: a warm-up never takes one, so it reads W, 1, 2, D (3rd working set), 4
  let wn = 0
  const nums = entry.sets.map(x => (x.tech === 'warmup' ? 0 : ++wn))
  const openTech = i => {
    if (!useStore.getState().S.seenTechHint) useStore.getState().update(S => { S.seenTechHint = true })
    useUI.getState().openSheet(close => <TechSheet entryIdx={entryIdx} i={i} close={close} />, { label: t('Set type') })
  }
  return <>
    <Media ex={ex} key={entry.id} compact={compact} minimizable />
    <div className="row between" style={{ marginBottom: 6 }}>
      <div style={{ fontSize: compact ? 17 : 20, fontWeight: 600, letterSpacing: '-.02em', textTransform: 'capitalize', lineHeight: 1.2 }}>{ex.n}</div>
      <div className="row" style={{ gap: 6, flex: 'none' }}>
        <button className="iconbtn" aria-label={t('Swap exercise')} onClick={onSwap}><Icon name="shuffle" /></button>
        <button className="iconbtn" aria-label={t('Details')} onClick={() => exerciseDetailSheet(ex)}><Icon name="info" /></button>
      </div>
    </div>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      {/* You log the total; this is the split, so the set in front of you is unambiguous
          without the rep count having to mean two different things (issue #31). */}
      {!cardio && !timed && isPerSide(cfg) && <span className="tag acc nocap"><Icon name="shuffle" />{t('{0} per side', fmtNum(sideReps(entry.sets.find(s => !s.done)?.r ?? entry.sets[0]?.r)))}</span>}
      {(ex.tg || ex.bp) && <span className="tag">{t(ex.tg || ex.bp)}</span>}
      {ex.eq && <span className="tag">{t(ex.eq)}</span>}
      {best > 0 && <span className="tag nocap">{t('Best:')} {fmtNum(best)} {S.unit}</span>}
    </div>
    {last && <button className="small muted lasttime" onClick={() => lastTimeSheet(entry.id, last)}>
      <span>{t('Last time')} ({fmtDate(last.d)}): {lastLine(entry.id, last, S.unit)}</span><Icon name="chevronRight" /></button>}
    {plan && plan.why && plan.kind !== 'off' && <div className={'progline' + (plan.kind === 'deload' ? ' warn' : '')}>
      <Icon name={plan.kind === 'up' ? 'arrowUp' : plan.kind === 'deload' ? 'arrowDown' : 'lightbulb'} />
      <span>{t(...plan.why)}</span>
    </div>}
    <div className="card settable" id={'ex-' + entryIdx} style={{ marginTop: 10, marginBottom: 0 }}>
      {hint && repsMode && !S.seenTechHint && <div className="progline thint">
        <Icon name="lightbulb" /><span>{t('Tap a set number for warm-up, drop set and more.')}</span>
        <button className="thint-x" aria-label={t('Dismiss')} onClick={() => useStore.getState().update(S => { S.seenTechHint = true })}><Icon name="xmark" /></button></div>}
      <div className="sethead"><span className="n-sp" /><span className="w-sp">{col1.hd}</span>{col2 && <span className="r-sp">{col2.hd}</span>}{timed && <span className="ck-sp" />}<span className="ck-sp" /></div>
      {entry.sets.map((s, i) => {
        const isParts = repsMode && PARTS_TECH.includes(s.tech)
        const parts = isParts ? s.parts || [] : []
        const badge = techBadge(s)
        const nCls = s.tech === 'warmup' ? ' w' : badge ? ' t' : ''
        const nLabel = s.tech ? t('Set {0}, {1}, tap to change', nums[i] || i + 1, techName(s.tech)) : t('Set {0}, tap to change set type', nums[i])
        return <div key={i} className={'setgrp' + (s.done ? ' done' : '')}><div className={'setrow' + (s.done ? ' done' : i === nextIdx ? ' next' : '')}>
        {repsMode ? <button className={'n tb' + nCls} onClick={() => openTech(i)} aria-label={nLabel}>{badge || nums[i]}</button>
          : <div className="n">{i + 1}</div>}
        {cell(s, i, col1, 'w')}
        {col2 && cell(s, i, col2, 'r')}
        {/* A timed set is started, not typed: the timer counts the hold down and checks the
            set off itself. The checkbox stays for anyone who timed it on their own watch. */}
        {timed && <button className="setgo" aria-label={t('Start set')} disabled={s.done || !!working}
          onClick={() => onStartTimed(i)}><Icon name="play" /></button>}
        <Check checked={s.done} onChange={() => onToggle(i)} />
      </div>
        {effOpen === i ? <div className="effrow" role="radiogroup" aria-label={col3.hd}>
          <span className="effq">{kind === 'rir' ? t('Reps left?') : t('How hard?')}</span>
          {chips.map(v => <button key={v} role="radio" aria-checked={s[col3.f] === v} className={'effchip' + (s[col3.f] === v ? ' on' : '')}
            onClick={() => { onField(i, col3.f, s[col3.f] === v ? null : v); setPick(null) }}>{chipLabel(v)}</button>)}
        </div> : col3 && s.done && !noEff(s) && s[col3.f] != null && <button className="effedit eff" onClick={() => setPick(i)}>
          <span className="effpill">{col3.hd} {fmtNum(s[col3.f])}</span>{t('Edit')}</button>}
        {parts.map((p, j) => <div key={j} className="setrow partrow">
          <span className="pn" aria-hidden="true" />
          {cell(s, i, col1, 'w' + (col1.f === 'r' && !(p.r > 0) ? ' need' : ''), j)}
          {col2 && cell(s, i, col2, 'r' + (!(p.r > 0) ? ' need' : ''), j)}
          <button className="pdel" aria-label={t('Remove part')} onClick={() => onRemovePart(i, j)}><Icon name="xmark" /></button>
        </div>)}
        {isParts && parts.length < MAX_PARTS && <button className="effedit padd" onClick={() => onAddPart(i)}><Icon name="plus" />{s.tech === 'drop' ? t('Add drop') : t('Add mini-set')}</button>}
        {repsMode && s.partials > 0 && <button className="effedit tpart" onClick={() => openTech(i)}>{t('+{0} partial reps', s.partials)}</button>}
      </div>})}
      <div style={{ height: 8 }} />
      <div className="row">
        <Button size="sm" icon="minus" disabled={entry.sets.length <= 1} onClick={onRemoveSet}>{t('Remove set')}</Button>
        <Button size="sm" icon="plus" onClick={onAddSet}>{t('Add set')}</Button>
      </div>
    </div>
  </>
}

/* ---------- active workout ---------- */
function ActiveWorkout() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const { startRest, stopRest } = useUI.getState()   // actions only: subscribing re-rendered the whole workout every timer tick
  const A = S.active
  const units = supersetUnits(A.entries)
  const cur = Math.min(A.cur, Math.max(0, A.entries.length - 1))
  const unit = A.entries.length ? unitOf(units, cur) : []
  const unitIdx = units.findIndex(u => u === unit)
  const isSuperset = unit.length > 1

  const unitDone = unit.length > 0 && unit.every(ui => A.entries[ui].sets.every(x => x.done))
  // progress counts every set you tick, warm-ups included, so 100% stays reachable (stats still skip them)
  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  const done = A.entries.reduce((n, e) => n + e.sets.filter(x => x.done).length, 0)

  const mutEntry = (idx, fn) => update(s => { fn(s.active.entries[idx]) }, true)
  // Clearing an optional field drops the key rather than storing null, so a set only carries
  // what was actually logged — in the session, in history and in a backup.
  // Blank parts still sitting on their seeded weight follow a weight change above them
  // (main 100 -> drop part 80), so the prefill never goes stale. Typed/filled parts are left alone.
  const follow = (set, from, oldPrev) => {
    let po = oldPrev, pn = from < 0 ? set.w : set.parts[from].w
    for (let j = from + 1; j < (set.parts || []).length; j++) {
      const p = set.parts[j], ow = p.w
      if (!(p.r > 0) && p.w === nextPartW(set.tech, po)) p.w = nextPartW(set.tech, pn)
      po = ow; pn = p.w
    }
  }
  const setField = (idx, i, field, v) => mutEntry(idx, e => {
    const x = e.sets[i], old = x.w
    if (v == null) delete x[field]; else x[field] = v
    if (field === 'w' && x.parts) follow(x, -1, old)
  })
  const setPart = (idx, i, j, f, v) => mutEntry(idx, e => { const x = e.sets[i], old = x.parts[j].w; x.parts[j][f] = v; if (f === 'w') follow(x, j, old) })
  const addPart = (idx, i) => mutEntry(idx, e => { const x = e.sets[i]; x.parts = x.parts || []; if (x.parts.length < MAX_PARTS) x.parts.push(nextPart(x)) })
  const removePart = (idx, i, j) => mutEntry(idx, e => { e.sets[i].parts.splice(j, 1) })
  const modeAt = idx => modeOf({ ...(A.entries[idx].target || {}), id: A.entries[idx].id })
  const addSet = idx => mutEntry(idx, e => {
    const l = e.sets[e.sets.length - 1]
    const m = modeOf({ ...(e.target || {}), id: e.id })
    if (m === 'cardio') e.sets.push({ min: l ? l.min : (e.target.min || 20), speed: l ? l.speed : (e.target.speed || 8), done: false })
    else if (m === 'time') e.sets.push({ sec: l ? l.sec : (e.target.sec || 45), w: l ? (l.w || 0) : (e.target.weight || 0), done: false })
    else e.sets.push({ w: l ? l.w : 0, r: l ? l.r : e.target.reps, done: false })
  })
  const removeSet = idx => mutEntry(idx, e => { if (e.sets.length > 1) e.sets.pop() })
  // Swap for today only: the routine is untouched, and the old exercise's logged sets go with it.
  const swapEntry = idx => {
    const e = A.entries[idx], old = exOr(e.id)
    const go = () => {
      const p = exercisePicker(ex => exConfigSheet(ex, swapConfig(e.target || {}, old, ex), cfg => {
        p.close()
        update(s => {
          const full = { ...cfg, id: ex.id }
          const plan = nextPrescription(s, full, s.routines.find(r => r.id === s.active.routineId))
          s.active.entries[idx] = { id: ex.id, sg: s.active.entries[idx].sg, target: { ...cfg }, plan, sets: applyPrescription(buildSets(s, full), plan) }
        })
      }, null, S.routines.find(r => r.id === A.routineId)), { like: old })
    }
    if (e.sets.some(x => x.done)) confirmSheet({ title: t('Swap {0}?', old.n.replace(/^./, c => c.toUpperCase())), message: t('The sets you logged for it in this session will be dropped.'), confirmText: t('Swap'), onConfirm: go })
    else go()
  }

  // A timed set is held, not typed. The work timer records what was actually held — an early
  // finish logs 0:38 of a 0:45 target rather than crediting the full prescription — and then
  // checks the set off through the normal path, so rest, supersets and the finish prompt all
  // behave exactly as they do for a reps set.
  const startTimed = (idx, i) => {
    const e = A.entries[idx]
    useUI.getState().startWork(e.sets[i].sec || 45, exOr(e.id).n, elapsed => {
      mutEntry(idx, en => { en.sets[i].sec = elapsed })
      if (!useStore.getState().S.active.entries[idx].sets[i].done) toggle(idx, i)
    })
  }

  const toggle = (idx, i) => {
    let exJustDone = false, workoutDone = false, checked = false
    mutEntry(idx, e => {
      e.sets[i].done = !e.sets[i].done
      if (e.sets[i].done) {
        checked = true
        vibrate(30)
        armStale()
        const isLastExInUnit = idx === unit[unit.length - 1]
        const unitDone = unit.every(ui => (ui === idx ? e : A.entries[ui]).sets.every(x => x.done))
        if (isLastExInUnit && !unitDone) startRest(S.restSec)
        else if (unitDone) stopRest()
        // done means every set of every exercise, not just reaching the last one (QA: fired at 1/6)
        if (unitDone && A.entries.every((en, k) => (k === idx ? e : en).sets.every(x => x.done))) workoutDone = true
        // no sheet mid-workout any more: working weights are reviewed once, in the finish sheet
        if (e.sets.every(x => x.done)) exJustDone = true
      }
    })
    if (!checked) return
    play(S.sound, exJustDone && !workoutDone ? exDoneSnd : setDoneSnd)
    // the burst starts at the ticked set, so read its spot before the scroll below moves it
    const at = (exJustDone && !workoutDone) ? (document.querySelectorAll(`#ex-${idx} .setgrp`)[i] || document.getElementById('ex-' + idx))?.getBoundingClientRect() : null
    // bring this exercise's next set up from under the rest timer (small phones especially)
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
    requestAnimationFrame(() => document.querySelector(`#ex-${idx} .setrow.next`)?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' }))
    if (workoutDone) finishWorkout(true)
    else if (exJustDone) {
      // celebrate instead of a toast: chime, a buzz and confetti (skipped under reduced motion)
      vibrate([30, 50, 20])
      confetti({ particleCount: 40, spread: 70, startVelocity: 30, ticks: 120, scalar: 0.8, zIndex: 150, disableForReducedMotion: true,
        colors: ['--acc', '--blue', '--orange', '--yellow', '--pink', '--purple'].map(v => getComputedStyle(document.documentElement).getPropertyValue(v).trim()).filter(Boolean),
        origin: at ? { x: (at.left + at.width / 2) / innerWidth, y: (at.top + at.height / 2) / innerHeight } : { y: 0.8 } })
    }
  }


  const addExercise = () => { const p = exercisePicker(ex => exConfigSheet(ex, null, cfg => { p.close(); update(s => {
    const full = { ...cfg, id: ex.id }
    const plan = nextPrescription(s, full, s.routines.find(r => r.id === s.active.routineId))
    s.active.entries.push({ id: ex.id, target: { ...cfg }, plan, sets: applyPrescription(buildSets(s, full), plan) })
    s.active.cur = s.active.entries.length - 1
  }) }, null, S.routines.find(r => r.id === A.routineId))) }
  const discard = () => confirmSheet({ title: t('Discard workout?'), message: t('The sets you logged in this session will be lost.'), confirmText: t('Discard'), danger: true, onConfirm: () => { update(s => { s.active = null }); stopRest(); cancelStale(); nav('/home') } })
  // the rare actions live behind ⋯ so the bottom of the page has one job: move on, or finish
  const menu = () => useUI.getState().openSheet(close => <>
    <h3>{A.name}</h3>
    <Button icon="plus" onClick={() => { close(); addExercise() }}>{t('Add exercise')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="danger" icon="trash" onClick={() => { close(); discard() }}>{t('Discard workout')}</Button>
  </>)

  return <div className="narrow">
    <div className="hdr">
      {/* leaving is not discarding: the workout keeps running and the Start tab turns into Resume */}
      <button className="iconbtn" aria-label={t('Back')} onClick={() => nav('/home')}><Icon name="chevronLeft" /></button>
      <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 600 }}>{A.name}</div><div className="sub"><Elapsed start={A.start} /> · {t('{0} sets', done + '/' + total)}</div></div>
      {/* was an unlabelled ✓ that finished the workout on a stray tap; Finish now lives only at the bottom */}
      <button className="iconbtn" aria-label={t('More')} onClick={menu}><Icon name="more" /></button>
    </div>
    <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>

    {A.entries.length ? <>
      <div className="muted small" style={{ marginBottom: 6 }}>{isSuperset ? t('Superset {0} / {1}', unitIdx + 1, units.length) : t('Exercise {0} / {1}', unitIdx + 1, units.length)}</div>
      {isSuperset ? (
        <div className="ss-card">
          <div className="ss-hd"><Icon name="link" />{t('Superset · do these back-to-back, rest after both')}</div>
          {unit.map((idx, k) => <div key={idx} className="ss-ex">
            {k > 0 && <div className="ss-amp">+</div>}
            <ExerciseBlock entryIdx={idx} compact
              onToggle={i => toggle(idx, i)} onField={(i, f, v) => setField(idx, i, f, v)} onPart={(i, j, f, v) => setPart(idx, i, j, f, v)} onAddPart={i => addPart(idx, i)} onRemovePart={(i, j) => removePart(idx, i, j)} hint={k === 0} onAddSet={() => addSet(idx)} onRemoveSet={() => removeSet(idx)} onStartTimed={i => startTimed(idx, i)} onSwap={() => swapEntry(idx)} />
          </div>)}
        </div>
      ) : (
        <ExerciseBlock entryIdx={cur} onToggle={i => toggle(cur, i)} onField={(i, f, v) => setField(cur, i, f, v)} onPart={(i, j, f, v) => setPart(cur, i, j, f, v)} onAddPart={i => addPart(cur, i)} onRemovePart={(i, j) => removePart(cur, i, j)} hint onAddSet={() => addSet(cur)} onRemoveSet={() => removeSet(cur)} onStartTimed={i => startTimed(cur, i)} onSwap={() => swapEntry(cur)} />
      )}
    </> : <div className="empty"><div className="ico"><Icon name="shuffle" /></div>{t('Freestyle workout — add your first exercise.')}</div>}

    <div style={{ height: 12 }} />
    <div className="row">
      <Button icon="chevronLeft" disabled={unitIdx <= 0} onClick={() => update(s => { s.active.cur = units[unitIdx - 1][0] })}>{t('Prev')}</Button>
      <Button variant={unitDone ? 'primary' : 'tinted'} trailingIcon="chevronRight" disabled={unitIdx < 0 || unitIdx >= units.length - 1} onClick={() => update(s => { s.active.cur = units[unitIdx + 1][0] })}>{t('Next')}</Button>
    </div>
    <div style={{ height: 10 }} />
    {!A.entries.length && <><Button variant="tinted" icon="plus" onClick={addExercise}>{t('Add exercise')}</Button><div style={{ height: 10 }} /></>}
    {(() => {
      const exDone = A.entries.filter(e => e.sets.length && e.sets.every(s => s.done)).length
      const allDone = A.entries.length > 0 && exDone === A.entries.length
      return <Button variant={allDone ? 'primary' : 'plain'} icon="flag" onClick={() => finishWorkout()}>
        {allDone || !done ? t('Finish workout') : t('Finish · {0} exercises', exDone + '/' + A.entries.length)}
      </Button>
    })()}
    <div style={{ height: 24 }} />
  </div>
}

export default function Workout() {
  const active = useStore(s => s.S.active)
  // the finish summary sits over this view; don't flash the start chooser behind it
  const finishing = useUI(s => s.sheets.some(x => x.finish))
  return active ? <ActiveWorkout /> : finishing ? null : <StartChooser />
}
