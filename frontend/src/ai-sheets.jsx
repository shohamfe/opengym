// "Build with AI" (design.md §2.7, ai-options.md S2): copy a prompt into your own AI chat,
// paste its answer back, check every exercise, then add it through the additive mergePlan.
import { useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXIDX } from './lib/exercises.js'
import { exCount } from './lib/format.js'
import { t, getLang } from './lib/i18n.js'
import { nav } from './lib/nav.js'
import { mergePlan } from './lib/plan-share.js'
import { buildPrompt, extractPlan, matchExercises, initialRes, openCount, toBundle, rowKey } from './lib/ai-import.js'
import { pregOf, labelOf, reasonOf } from './lib/pregnancy.js'
import { exercisePicker, customExSheet } from './sheets.jsx'
import { Thumb } from './components/Media.jsx'
import Icon from './components/Icon.jsx'
import { Button, Switch, Row, Section, TextArea } from './components/ui.jsx'

const S = () => useStore.getState().S
const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const ASK_JSON = 'Please give me the final plan as one json code block.'
const SEEN = 'gym_ai_preg_ok'   // per device: the pregnancy privacy note was accepted once

async function copyText(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done) }
  catch (e) { ui().openSheet(close => <ManualCopy text={text} close={close} />) }
}
function ManualCopy({ text, close }) {
  return <>
    <h3>{t('Copy this prompt')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Copying was blocked. Select all of the text, copy it, then paste it into your AI chat.')}</div>
    <TextArea readOnly rows={10} value={text} onFocus={e => e.target.select()} />
    <div style={{ height: 12 }} />
    <Button onClick={close}>{t('Done')}</Button>
  </>
}

function copyPrompt(noPreg) {
  copyText(buildPrompt(S(), { lang: getLang(), noPreg }), t('Prompt copied — paste it into a new chat with your AI'))
}
function startCopy() {
  let seen = false
  try { seen = localStorage.getItem(SEEN) === '1' } catch (e) { /* private mode: ask again */ }
  if (!pregOf(S()) || seen) { copyPrompt(false); return }
  ui().openSheet(close => <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <h3 style={{ marginBottom: 8 }}>{t('Before you copy')}</h3>
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>{t('This prompt includes your pregnancy week and profile. It goes to the AI app you paste it into.')}</div>
    <Button variant="primary" onClick={() => { try { localStorage.setItem(SEEN, '1') } catch (e) { /* */ } close(); copyPrompt(false) }}>{t('Continue')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => { close(); copyPrompt(true) }}>{t('Remove pregnancy info')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>, { kind: 'center' })
}

/* ---------------------------------- entry sheet ---------------------------------- */
export const aiSheet = () => ui().openSheet(close => <AiSheet close={close} />)

function AiSheet({ close }) {
  const st = useStore(s => s.S)
  const preg = !!pregOf(st)
  return <>
    <h3>{t('Build with AI')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Use your own Claude, ChatGPT or Gemini. It’s free for you and for us.')}</div>
    <Section footer={preg
      ? t('Shared with your AI: body, pregnancy week, training level, equipment and your routines.')
      : t('Shared with your AI: body, training level, equipment and your routines.')}>
      <Row icon="clipboard" title={t('Copy prompt for your AI')} subtitle={t('Paste it into a new chat and plan together.')} accessory="chevron" onClick={startCopy} />
      <Row icon="download" title={t('Paste plan from AI')} subtitle={t('You check every exercise before anything is added.')} accessory="chevron" onClick={() => { close(); pasteSheet() }} />
    </Section>
    <Section title={t('Connect your AI')} footer={t('Claude: works on the free plan (add as a connector). ChatGPT: paid plan, on the web, experimental.')}>
      <Row icon="link" title={t('Connect your AI')} accessory="chevron" onClick={() => { close(); nav('/connect-ai') }} />
    </Section>
  </>
}

/* ---------------------------------- paste ---------------------------------- */
export const pasteSheet = () => ui().openSheet(close => <PasteSheet close={close} />)

const ERR = {
  none: 'Couldn’t find a plan in what you pasted. In your AI chat, ask:',
  cutoff: 'The plan looks cut off. Ask your AI: “Continue the json” or “Give the plan again, shorter”.',
  empty: 'This plan has no routines.'
}
function PasteSheet({ close }) {
  const [text, setText] = useState('')
  const [err, setErr] = useState(null)
  const canRead = !!navigator.clipboard?.readText
  const paste = async () => {
    try { setText(await navigator.clipboard.readText()); setErr(null) }
    catch (e) { toast(t('Long-press the box and choose Paste.')) }
  }
  const check = () => {
    const r = extractPlan(text)
    if (r.error) { setErr(r.error); return }
    close()
    reviewSheet(matchExercises(r.plan, S()), r.count)
  }
  return <>
    <h3>{t('Paste plan from AI')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Paste your AI’s whole reply. The app finds the plan in it.')}</div>
    <TextArea rows={8} value={text} onChange={e => { setText(e.target.value); setErr(null) }} placeholder={t('Paste here')} aria-label={t('Paste plan from AI')} />
    {canRead && <><div style={{ height: 8 }} /><Button icon="clipboard" onClick={paste}>{t('Paste')}</Button></>}
    {err && <div className="exnote" role="alert" style={{ marginTop: 12, borderLeft: '3px solid var(--red)', color: 'var(--label)' }}>
      {t(ERR[err])}
      {err === 'none' && <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center' }}>
        <i className="grow">“{t(ASK_JSON)}”</i>
        <Button size="sm" variant="tinted" style={{ width: 'auto' }} onClick={() => copyText(t(ASK_JSON), t('Copied'))}>{t('Copy')}</Button>
      </div>}
    </div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={check} disabled={!text.trim()}>{t('Check plan')}</Button>
  </>
}

/* ---------------------------------- review ---------------------------------- */
export const reviewSheet = (m, count) => ui().openSheet(close => <Review m={m} count={count} close={close} />)

function warnText(w) {
  if (w.k === 'unit') return t('Weights converted from {0} to {1}.', w.from, w.to)
  if (w.k === 'routines') return t('The plan has {0} routines; only the first 14 are used.', w.n)
  if (w.k === 'exercises') return t('Routines are capped at 30 exercises; the rest were not added.')
  if (w.k === 'clamped') return t('{0} numbers were out of range and were adjusted.', w.n)
  if (w.k === 'week') return t('{0} schedule days point to a routine that isn’t in the plan and were ignored.', w.n)
}

function Review({ m, count, close }) {
  const st = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [res, setRes] = useState(() => initialRes(m))
  const [schedule, setSchedule] = useState(false)
  const set = (k, v) => setRes(r => ({ ...r, [k]: v }))
  const open = openCount(m, res, st)
  const total = m.routines.reduce((n, r) => n + r.rows.length, 0)
  const toCheck = m.routines.reduce((n, r) => n + r.rows.filter(x => x.status !== 'ok').length, 0)
  const byName = m.routines.flatMap(r => r.rows.filter(x => x.how === 'name' && x.status === 'ok'))
  const days = Object.keys(m.week).length

  const apply = () => {
    const bundle = toBundle(m, res)
    update(s => mergePlan(s, bundle, { schedule }))
    close()
    toast(t('Added {0} routines to your plan', bundle.routineCount))
    nav('/plan')
  }

  return <>
    <h3>{m.name ? t('Import “{0}”', m.name) : t('Import this plan')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>
      {t(m.routines.length === 1 ? '{0} routine' : '{0} routines', m.routines.length)}{' · ' + exCount(total)}
      {toCheck > 0 && ' · ' + t('{0} need your check', toCheck)}
    </div>
    <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.4 }}>{t('These are added as new routines — nothing you already have is changed.')}</div>
    {[count > 1 && t('Found {0} plans in the text; using the last one.', count), ...m.warnings.map(warnText)].filter(Boolean).map((w, i) =>
      <div key={i} className="small" style={{ color: 'var(--yellow-t)', marginBottom: 8, lineHeight: 1.4 }}>{w}</div>)}

    {m.routines.map((r, ri) => {
      const rows = r.rows.map((row, xi) => [row, xi]).filter(([row, xi]) => {
        const v = res[rowKey(ri, xi)]
        return row.status !== 'ok' || (v && v !== 'skip' && ['avoid', 'caution'].includes(labelOf(v.id, st)))
      })
      if (!rows.length) return null
      return <div key={ri}>
        <h4 className="sec">{r.name || t('Shared routine')}</h4>
        {rows.map(([row, xi]) => <CheckRow key={xi} row={row} v={res[rowKey(ri, xi)]} st={st} set={v => set(rowKey(ri, xi), v)} />)}
      </div>
    })}

    {byName.length > 0 && <details style={{ margin: '14px 2px' }}>
      <summary className="small dim" style={{ minHeight: 40, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>{t('{0} matched by name', byName.length)}</summary>
      {byName.map((row, i) => <div key={i} className="small dim" style={{ padding: '3px 0' }}>{row.ai.name} → <span className="capitalize">{EXIDX[row.pick]?.n}</span></div>)}
    </details>}

    {days > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', borderBottom: '1px solid var(--sep)', margin: '14px 0 16px', gap: 12 }}>
      <div><div className="tt" style={{ fontSize: 15 }}>{t('Use this weekly schedule')}</div><div className="small dim">{t('Replaces your current Mon–Sun assignments.')}</div></div>
      <Switch checked={schedule} onChange={setSchedule} />
    </div>}
    <div style={{ height: 8 }} />
    <Button variant="primary" onClick={apply} disabled={open > 0}>{open > 0 ? t('Resolve {0} more', open) : t('Add to my plan')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

// One exercise that needs a tap: pick a suggestion, search, create a custom one, or skip.
// An exercise usually avoided in pregnancy needs Swap, Keep or Skip.
function CheckRow({ row, v, st, set }) {
  const name = row.ai.name || t('Unnamed exercise')
  const id = v && v !== 'skip' ? v.id : null
  const lab = id ? labelOf(id, st) : null
  const search = () => { const p = exercisePicker(ex => { p.close(); set({ id: ex.id }) }, { query: row.ai.name }) }
  const swap = () => { const p = exercisePicker(ex => { p.close(); set({ id: ex.id }) }, { like: EXIDX[id] }) }
  const custom = () => customExSheet(null, ex => ex && set({ id: ex.id }), row.ai.name)
  const sugg = [...new Set([...row.sugg, ...(id ? [id] : [])])].filter(x => EXIDX[x])

  return <div style={{ marginBottom: 16 }}>
    <div className="row between" style={{ gap: 8, marginBottom: 6, alignItems: 'baseline' }}>
      <div className="tt capitalize" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{name}</div>
      {v === 'skip' && <span className="tag nocap">{t('Skipped')}</span>}
    </div>
    {v === 'skip'
      ? <Button size="sm" variant="tinted" icon="reset" onClick={() => set(undefined)}>{t('Undo')}</Button>
      : <>
        {row.status !== 'ok' && row.status !== 'avoid' && <div className="small dim" style={{ marginBottom: 6 }}>
          {row.how === 'mismatch' ? t('The id and the name don’t match. Pick the right one.')
            : sugg.length ? t('Not found in the library. Pick the closest one.') : t('No close match.')}
        </div>}
        {sugg.length > 0 && row.status !== 'ok' && row.status !== 'avoid' && <div className="list">
          {sugg.map(x => <div key={x} className="item" role="button" aria-pressed={id === x} onClick={() => set({ id: x })}>
            <Thumb ex={EXIDX[x]} />
            <div className="grow"><div className="tt capitalize">{EXIDX[x].n}</div><div className="ss capitalize">{t(EXIDX[x].tg || EXIDX[x].bp)} · {t(EXIDX[x].eq)}</div></div>
            {id === x && <Icon name="check" className="accent" />}
          </div>)}
        </div>}
        {lab === 'avoid' && !v.keep && <div className="exnote" role="alert" style={{ marginTop: 8, borderLeft: '3px solid var(--red)', color: 'var(--label)' }}>
          <span className="capitalize">{EXIDX[id]?.n}</span>: {t('Usually avoided in pregnancy')}{reasonOf(id, st) ? ': ' + t(reasonOf(id, st)) : ''}
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <Button size="sm" variant="tinted" icon="shuffle" onClick={swap}>{t('Swap')}</Button>
            <Button size="sm" variant="tinted" onClick={() => set({ id, keep: true })}>{t('Keep')}</Button>
            <Button size="sm" variant="tinted" onClick={() => set('skip')}>{t('Skip')}</Button>
          </div>
        </div>}
        {lab === 'avoid' && v.keep && <div className="small" style={{ color: 'var(--label-2)', marginTop: 6 }}>{t('Kept: usually avoided in pregnancy.')}</div>}
        {lab === 'caution' && <div style={{ marginTop: 6 }}><span className="tag pg care"><Icon name="warn" />{t('Take care')}</span></div>}
        {row.status !== 'ok' && row.status !== 'avoid' && <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <Button size="sm" variant="tinted" icon="magnifier" style={{ width: 'auto' }} onClick={search}>{t('Search library…')}</Button>
          {row.ai.name && <Button size="sm" variant="tinted" icon="plus" style={{ width: 'auto' }} onClick={custom}>{t('Create custom “{0}”', row.ai.name)}</Button>}
          <Button size="sm" variant="ghost" style={{ width: 'auto' }} onClick={() => set('skip')}>{t('Skip this exercise')}</Button>
        </div>}
      </>}
  </div>
}
