import { useParams, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, dateLocale } from '../lib/i18n.js'
import { back } from '../lib/nav.js'
import { fmtNum, exCount } from '../lib/format.js'
import { exOr, EXIDX } from '../lib/exercises.js'
import { setLabel, modeOf, isBw, fmtSec, EFFORT } from '../lib/history.js'
import { glyphOf } from '../lib/glyphs.js'
import { wStats, StatCell, confirmSheet } from '../sheets.jsx'
import Media, { Thumb } from '../components/Media.jsx'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

const done = e => e.sets.filter(s => s.done)
const nameOf = (e, ex) => EXIDX[e.id]?.n || e.n || ex.n
// No per-set PR data: mark the first set at the top weight of a PR exercise (reps mode only).
const prSet = (w, e, mode, sets) => {
  if (mode !== 'reps' || !w.prs?.includes(e.id)) return -1
  const top = Math.max(...sets.map(s => s.w || 0))
  return top > 0 ? sets.findIndex(s => (s.w || 0) === top) : -1
}

// Reserved for special set techniques (badge under the set, sub-rows sharing the same columns).
function TechSlot({ set, cols, tpl }) { return null }

function ExerciseView({ w, e }) {
  const S = useStore(s => s.S)
  const ex = exOr(e.id), sets = done(e), name = nameOf(e, ex)
  const mode = modeOf({ ...e.target, id: e.id })
  const bw = mode === 'reps' && isBw({ ...e.target, id: e.id })
  const added = sets.some(s => s.w > 0)
  const load = { f: 'w', hd: (bw ? t('Added ({0})', S.unit) : t('Weight ({0})', S.unit)), fmt: s => (bw ? '+' : '') + fmtNum(s.w || 0), wide: true }
  const reps = { f: 'r', hd: t('Reps') }
  const cols = mode === 'cardio' ? [{ f: 'min', hd: t('Duration (min)') }, { f: 'speed', hd: t('Speed (km/h)'), fmt: s => fmtNum(s.speed || 0) }]
    : mode === 'time' ? [{ f: 'sec', hd: t('Seconds'), fmt: s => fmtSec(s.sec) }, ...(added ? [{ ...load, fmt: s => fmtNum(s.w || 0) }] : [])]
      : bw && !added ? [reps] : [load, reps]
  const kind = mode === 'reps' && (sets.some(s => s.rir != null) ? 'rir' : sets.some(s => s.rpe != null) ? 'rpe' : null)
  const effKind = s => (s.rir != null ? 'rir' : 'rpe')
  const pr = w.prs?.includes(e.id), top = prSet(w, e, mode, sets)
  const tpl = ['28px', ...cols.map(c => (c.wide ? 'minmax(0,1.3fr)' : 'minmax(0,1fr)')), ...(kind ? ['40px'] : []), ...(top >= 0 ? ['20px'] : [])].join(' ')
  return <>
    <Media ex={ex} minimizable />
    <div className="row between wv-xh">
      <div className="wv-xn capitalize" dir="auto">{name}</div>
      {pr && <span className="pr" style={{ flex: 'none' }}><Icon name="trophy" />PR</span>}
    </div>
    <div className="row wv-tags">{(ex.tg || ex.bp) && <span className="tag">{t(ex.tg || ex.bp)}</span>}{ex.eq && <span className="tag">{t(ex.eq)}</span>}</div>
    {sets.length ? <div className="card settable wx-sets">
      <div className="rt-head" style={{ '--c': tpl }}><span />{cols.map(c => <span key={c.f}>{c.hd}</span>)}{kind && <span>{EFFORT[kind].hd}</span>}{top >= 0 && <span />}</div>
      {sets.map((s, i) => <div key={i} className="rt-set">
        <div className="rt-row" style={{ '--c': tpl }}>
          <span className="rt-n">{i + 1}</span>
          {cols.map(c => <span key={c.f} className="rt-v">{c.fmt ? c.fmt(s) : fmtNum(s[c.f] || 0)}</span>)}
          {kind && (s.rir != null || s.rpe != null ? <span className="rt-v eff">{fmtNum(s[effKind(s)])}</span> : <span className="rt-v nil">–</span>)}
          {top >= 0 && <span className="rt-flag">{i === top && <Icon name="trophy" aria-label="PR" />}</span>}
        </div>
        <TechSlot set={s} cols={cols} tpl={tpl} />
      </div>)}
    </div> : <div className="empty" style={{ padding: 20 }}>{t('No sets logged')}</div>}
  </>
}
const exerciseViewSheet = (w, e) => useUI.getState().openSheet(() => <ExerciseView w={w} e={e} />)

export default function WorkoutView() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const w = S.workouts.find(x => String(x.id) === id)
  const bk = () => back('/history')
  const backBtn = <button className="iconbtn" onClick={bk} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
  if (!w) return <>
    <div className="hdr">{backBtn}</div>
    <div className="empty"><div className="ico"><Icon name="history" /></div>
      <div className="t-head" style={{ color: 'var(--label)' }}>{t('Workout not found')}</div>
      <div style={{ marginBottom: 16 }}>{t('It may have been deleted.')}</div>
      <Button size="sm" variant="primary" onClick={() => nav('/history', { replace: true })}>{t('Go to History')}</Button></div>
  </>
  const clock = w.end - w.start >= 60000
  const d = new Date(w.d + 'T12:00:00'), loc = dateLocale()
  const dateLine = d.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    + (clock ? ' · ' + new Date(w.start).toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' }) : '')
  const routine = S.routines.find(r => r.id === w.routineId)
  const prs = w.prs ? w.prs.length : 0
  const [dur, sets, vol] = wStats(w, S.unit)
  const askDelete = () => confirmSheet({
    title: t('Delete this workout?'),
    message: t('{0} on {1} will be removed from your history for good.', w.name, d.toLocaleDateString(loc, { day: 'numeric', month: 'short' })),
    confirmText: t('Delete workout'), danger: true,
    onConfirm: () => { update(s => { s.workouts = s.workouts.filter(x => x.id !== w.id) }); useUI.getState().toast(t('Workout deleted')); bk() }
  })
  return <>
    <div className="hdr wv-hdr">
      {backBtn}
      <div className="wv-t"><h1 dir="auto">{w.name}</h1><div className="sub">{dateLine}</div></div>
      <button className="iconbtn wv-del" onClick={askDelete} aria-label={t('Delete workout')}><Icon name="trash" /></button>
    </div>
    <div className="wv-sum">
      <div className="wv-stats">{[[t('Duration'), dur], [t('Sets'), sets], [t('Volume'), vol]].map(([l, v]) => <div key={l} className="wv-s"><div className="l">{l}</div><StatCell v={v} cls="v" /></div>)}</div>
      {(prs > 0 || routine || w.bw) && <div className="wv-meta">
        {prs > 0 && <span className="pr"><Icon name="trophy" />{t('{0} PR', prs)}</span>}
        {routine && <span className="tag nocap"><Icon name={glyphOf(routine.emoji)} />{routine.name}</span>}
        {w.bw && <span className="tag nocap">{t('Body weight')} {fmtNum(w.bw)} {S.unit}</span>}
      </div>}
    </div>
    {w.entries.length ? <>
      <h4 className="sec">{exCount(w.entries.length)}</h4>
      <div className="list tight">{w.entries.map((e, i) => {
        const ex = exOr(e.id), ds = done(e)
        return <button key={i} className="item wx" onClick={() => exerciseViewSheet(w, e)}>
          <Thumb ex={ex} />
          <div className="grow"><div className="tt capitalize" dir="auto">{nameOf(e, ex)}</div>
            <div className="ss">{ds.length ? ds.map((s, k) => <span key={k}>{k ? ' · ' : ''}<span className="wx-set">{setLabel(e.id, s, e.target, { effort: false })}</span></span>) : t('No sets logged')}</div></div>
          {w.prs?.includes(e.id) && <span className="wx-pr" role="img" aria-label={t('Personal record')}><Icon name="trophy" /></span>}
          <Icon name="chevronRight" className="chev" />
        </button>
      })}</div>
    </> : <div className="empty">{t('No exercises were logged.')}</div>}
  </>
}
