import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine, effectiveRoutineId, streakWeeks, lastBW, setsDoneActive, workoutVolume } from '../lib/history.js'
import { fmtNum, todayISO, isoOf, weekKey, startOfWeek, DAYS } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { bwSheet, dayOverrideSheet, calendarSheet, startFlow, loadStarterPlan, bwDeltaColor, WorkoutRow } from '../sheets.jsx'
import { loadOfWorkouts, rankOf, MUSCLE_NAME } from '../lib/muscles.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { PregLine } from '../components/Pregnancy.jsx'

const KEY = { done: 'Done', plan: 'Planned', ovr: 'Moved' }
const MINOR = ['serratus', 'obliques', 'adductors', 'hip-flexors', 'tibialis', 'forearm']

// Home = what to do now + a quick glance. Deep charts & history live in Stats.
// Email sign-in uses the address as the name; never print it as one.
const greeting = (d, name) => {
  const h = d.getHours(), g = t(h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening')
  return name && !name.includes('@') ? `${g}, ${name}` : g
}

export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const [weekOffset, setWeekOffset] = useState(0)

  const today = new Date()
  const routine = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  const wkStart = startOfWeek(today, S.weekStart); wkStart.setDate(wkStart.getDate() + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  const strip = [], kinds = new Set()
  for (let i = 0; i < 7; i++) {
    const d = new Date(wkStart); d.setDate(wkStart.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineId(S, iso), ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dot = done ? ' done' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    if (dot) kinds.add(dot.trim())
    strip.push(<div key={i} role="button" aria-label={d.getDate() + ' ' + t(DAYS[d.getDay()]) + (dot ? ', ' + t(KEY[dot.trim()]) : '')} className={'wday' + (iso === todayISO() ? ' today' : '')} onClick={() => dayOverrideSheet(iso)}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const wkEnd = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${wkStart.getDate()} ${wkStart.toLocaleDateString(dateLocale(), { month: 'short' })} – ${wkEnd.getDate()} ${wkEnd.toLocaleDateString(dateLocale(), { month: 'short' })}`

  const wThisWeek = S.workouts.filter(w => weekKey(w.d, S.weekStart) === weekKey(todayISO(), S.weekStart)).length
  const plannedPerWeek = Object.keys(S.week).filter(k => S.week[k]).length

  // glance cards: last session, this week vs last, what hasn't been trained
  const lastW = S.workouts[S.workouts.length - 1]
  const thisWk = weekKey(todayISO(), S.weekStart)
  const prevStart = startOfWeek(today, S.weekStart); prevStart.setDate(prevStart.getDate() - 7)
  const prevWk = weekKey(isoOf(prevStart), S.weekStart)
  const wkWorkouts = S.workouts.filter(w => weekKey(w.d, S.weekStart) === thisWk)
  const volOf = ws => ws.reduce((v, w) => v + (w.vol ?? workoutVolume(w)), 0)
  const vol = volOf(wkWorkouts), prevVol = volOf(S.workouts.filter(w => weekKey(w.d, S.weekStart) === prevWk))
  const volPct = prevVol ? Math.round((vol - prevVol) / prevVol * 100) : null
  // small helper muscles (serratus, shins…) rarely get direct work; naming them first is noise
  const missed = rankOf(loadOfWorkouts(wkWorkouts)).missed.filter(m => !MINOR.includes(m))
  // on a rest day, say when the next session is instead of leaving "Rest day" on its own
  let next = null
  if (!routine && !S.active) for (let i = 1; i <= 7 && !next; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i)
    const r = effectiveRoutine(S, isoOf(d))
    if (r) next = { r, d }
  }

  // today's session shown right under the week strip
  const onToday = () => { if (S.active) nav('/workout'); else if (routine) startFlow(routine.id); else dayOverrideSheet(todayISO()) }

  return <div className="narrow">
    <div className="hdr home-hdr">
      <div><h1>{user || S.profile ? greeting(today, S.profile?.name || user?.name) : 'openGym'}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
    </div>
    <PregLine ask />

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ fontSize: 15 }} onClick={() => setWeekOffset(w => w - 1)} aria-label="Previous week"><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
        <button className="iconbtn" style={{ fontSize: 15 }} onClick={() => setWeekOffset(w => w + 1)} aria-label="Next week"><Icon name="chevronRight" /></button>
      </div>
      <div className="week">{strip}</div>
      {/* a key only earns its space when the week mixes dot colours; a lone green dot explains itself */}
      {kinds.size > 1 && <div className="wk-key">{['done', 'plan', 'ovr'].filter(k => kinds.has(k)).map(k =>
        <span key={k}><i className={'dot ' + k} />{t(KEY[k])}</span>)}</div>}
      <div className="today-row" onClick={onToday}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : routine ? 'var(--acc)' : 'var(--surface-3)' }}>
            <Icon name={S.active ? 'timer' : routine ? glyphOf(routine.emoji) : 'moon'} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Today')}{todayOvr && routine ? ' · ' + t('rescheduled') : ''}</div>
            <div className="ttl">{S.active ? t('{0} — in progress', S.active.name) : routine ? routine.name : t('Rest day')}</div>
            {next && <div className="small muted">{t('Next: {0}', next.r.name)} · {t(DAYS[next.d.getDay()])}</div>}
          </div>
        </div>
        {S.active ? <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{t('Resume')}</span>
          : routine ? <span className="btn primary sm" style={{ width: 'auto', flex: 'none' }}><Icon name="play" />{t('Start')}</span>
          : <Icon name="plus" className="chev" />}
      </div>
      <button className="streak-row" onClick={() => calendarSheet()}>
        <Icon name="flame" style={{ color: 'var(--orange)' }} />
        <b>{t('{0} week streak', streakWeeks(S))}</b>
        <span className="muted">· {wThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')}</span>
        <Icon name="chevronRight" className="chev" />
      </button>
    </div>

    {!S.routines.length && !S.active && (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i"><Icon name="sparkles" /></span>
          <div className="big" style={{ fontSize: 22 }}>{t('Welcome!')}</div>
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Set up your weekly routine to get going — or load a ready-made Push / Pull / Legs plan.')}</div>
        <Button variant="primary" icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (PPL)')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}

    {lastW && <>
      <div className="row between" style={{ margin: '4px 4px 6px' }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Last workout')}</h4>
        <Button size="sm" variant="ghost" trailingIcon="chevronRight" style={{ width: 'auto' }} onClick={() => nav('/history')}>{t('All')}</Button>
      </div>
      <div className="list" style={{ marginBottom: 12 }}><WorkoutRow w={lastW} onClick={() => nav('/history/' + lastW.id)} /></div>
      <div className="tiles">
        <div className="tile tappable" onClick={() => nav('/stats')}>
          <div className="l"><Icon name="dumbbell" />{t('Volume')}</div>
          <div className="v">{vol ? (vol >= 10000 ? fmtNum(Math.round(vol / 100) / 10) + 'k' : fmtNum(vol)) : '—'} <span className="muted" style={{ fontSize: 14 }}>{S.unit}</span></div>
          {/* down weeks are normal (deloads), so they're grey, never red */}
          <div className="small" style={{ color: volPct > 0 ? 'var(--acc)' : 'var(--label-2)' }}>
            {!vol ? t('none yet this week') : volPct == null ? t('first week logged') : t('{0} vs last week', (volPct > 0 ? '+' : '') + volPct + '%')}</div>
        </div>
        <div className="tile tappable" onClick={() => nav('/stats')}>
          <div className="l"><Icon name="target" />{t('Missed')}</div>
          <div className="v" style={{ fontSize: 22 }}>{!wkWorkouts.length ? '—' : missed.length ? t(MUSCLE_NAME[missed[0]]) : t('All covered')}</div>
          <div className="small muted">{!wkWorkouts.length ? t('this week') : missed.length > 1 ? t('+{0} more this week', missed.length - 1) : missed.length ? t('this week') : t('every muscle hit')}</div>
        </div>
      </div>
    </>}

    {/* the chart lives on Stats; Home keeps the number and the one action you take here */}
    <div className="card bw-row tappable" onClick={() => nav('/stats')}>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="small muted">{t('Body weight')}</div>
        {bw ? <>
          <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
            <span className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: '1rem' }}>{S.unit}</span></span>
            {!!delta && <span className="small row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(delta, bw.w) }}>
              <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />{fmtNum(Math.abs(delta))}</span>}
          </div>
          {S.targetW && <div className="small goal-t">{t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}</div>}
        </> : <div className="muted small">{t("No entries yet — log your weight to start the curve. It's also asked before every workout.")}</div>}
      </div>
      <Button size="sm" variant="tinted" icon="plus" onClick={ev => { ev.stopPropagation(); bwSheet() }}>{t('Log')}</Button>
    </div>
  </div>
}
