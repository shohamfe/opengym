// Stats cards borrowed from GymMane: body measurements, progress photos (this phone only),
// strength balance and a shareable month recap.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXIDX } from '../lib/exercises.js'
import { fmtNum, fmtDate, fmtVol, todayISO, isoOf } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { confirmSheet } from '../sheets.jsx'
import { strengthBalance, monthRecap } from '../lib/extras.js'
import { photoList, photoAdd, photoDel, shrinkImage } from '../lib/photos.js'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, SelectRow } from '../components/ui.jsx'

/* ---------- body measurements ---------- */
export const MEASURES = ['chest', 'waist', 'hips', 'arm', 'thigh', 'calf', 'neck']
const MNAME = { chest: 'Chest', waist: 'Waist', hips: 'Hips', arm: 'Arm', thigh: 'Thigh', calf: 'Calf', neck: 'Neck' }

function MeasureSheet({ close }) {
  const st = useStore(s => s.S)
  const today = todayISO()
  const last = {}
  ;(st.measures || []).forEach(m => MEASURES.forEach(k => { if (m[k] > 0) last[k] = m[k] }))
  const cur = (st.measures || []).find(m => m.d === today) || {}
  const [v, setV] = useState(() => Object.fromEntries(MEASURES.map(k => [k, cur[k] ?? null])))
  const save = () => {
    const row = { d: today }
    MEASURES.forEach(k => { if (v[k] > 0) row[k] = Math.round(v[k] * 10) / 10 })
    useStore.getState().update(s => {
      s.measures = (s.measures || []).filter(m => m.d !== today)
      if (Object.keys(row).length > 1) s.measures.push(row)
      s.measures.sort((a, b) => (a.d < b.d ? -1 : 1))
    })
    close()
  }
  return <>
    <h3>{t('Body measurements')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Today')}, {fmtDate(today, true)} · cm. {t('Leave blank what you did not measure.')}</div>
    {MEASURES.map(k => <div key={k} className="row between" style={{ padding: '6px 0', borderBottom: 'var(--hair) solid var(--sep)' }}>
      <span>{t(MNAME[k])}{last[k] ? <span className="dim small"> · {t('last')} {fmtNum(last[k])}</span> : null}</span>
      <NumberField nullable value={v[k]} onChange={x => setV(o => ({ ...o, [k]: x }))} className="mfield" aria-label={t(MNAME[k])} inputMode="decimal" style={{ width: 90, textAlign: 'end' }} />
    </div>)}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}

export function MeasuresCard({ S }) {
  const rows = S.measures || []
  const has = MEASURES.filter(k => rows.some(m => m[k] > 0))
  const [k, setK] = useState(null)
  const cur = has.includes(k) ? k : has[0]
  const pts = cur ? rows.filter(m => m[cur] > 0).map(m => ({ t: new Date(m.d + 'T12:00:00').getTime(), y: m[cur], d: m.d })) : []
  const delta = pts.length > 1 ? Math.round((pts[pts.length - 1].y - pts[0].y) * 10) / 10 : null
  return <div className="card">
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Body measurements')}</h2>
      <Button size="sm" icon="plus" onClick={() => useUI.getState().openSheet(close => <MeasureSheet close={close} />)}>{t('Log')}</Button>
    </div>
    {cur ? <>
      {has.length > 1 && <div className="sect-b" style={{ marginBottom: 10 }}>
        <SelectRow title={t('Measurement')} sheetTitle={t('Body measurements')} value={cur} onChange={setK} options={has.map(x => ({ value: x, label: t(MNAME[x]) }))} />
      </div>}
      <div className="chart"><LineChart points={pts} h={140} unit="cm" color="var(--purple)" /></div>
      {delta !== null && <div className="small dim" style={{ marginTop: 6 }}>{t('Since {0}:', fmtDate(pts[0].d, true))} <b>{delta > 0 ? '+' : ''}{fmtNum(delta)} cm</b></div>}
    </> : <div className="muted small">{t('Waist, chest, arms… log them once a month and watch the curve.')}</div>}
  </div>
}

/* ---------- progress photos (kept on this phone only) ---------- */
export function PhotosCard() {
  const [list, setList] = useState(null)
  const [cmp, setCmp] = useState(false)
  const reload = () => photoList().then(setList).catch(() => setList([]))
  useEffect(() => { reload() }, [])
  const add = async e => {
    const f = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!f) return
    try { await photoAdd(todayISO(), await shrinkImage(f)); reload() } catch { useUI.getState().toast(t('Could not save the photo')) }
  }
  const del = p => confirmSheet({ title: t('Delete this photo?'), confirmText: t('Delete'), danger: true, onConfirm: () => photoDel(p.id).then(reload) })
  if (!list) return null
  const first = list[0], last = list[list.length - 1]
  return <div className="card">
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Progress photos')}</h2>
      <label className="btn sm tinted" style={{ cursor: 'pointer' }}><Icon name="plus" />{t('Add')}
        <input type="file" accept="image/*" hidden onChange={add} /></label>
    </div>
    <div className="small dim" style={{ marginBottom: 10 }}>{t('Saved on this phone only. They are not synced or backed up.')}</div>
    {list.length > 1 && <Button size="sm" variant="tinted" onClick={() => setCmp(!cmp)} style={{ marginBottom: 10 }}>{cmp ? t('All photos') : t('Before and after')}</Button>}
    {cmp && list.length > 1
      ? <div className="photo-cmp">{[first, last].map(p => <figure key={p.id}><img src={p.url} alt={fmtDate(p.d, true)} /><figcaption className="small muted">{fmtDate(p.d, true)}</figcaption></figure>)}</div>
      : list.length ? <div className="photo-grid">{[...list].reverse().map(p => <button key={p.id} className="photo-cell" onClick={() => del(p)} aria-label={t('Delete photo from {0}', fmtDate(p.d, true))}>
        <img src={p.url} alt="" /><span className="small">{fmtDate(p.d, true)}</span></button>)}</div>
      : <div className="muted small">{t('Same spot, same light, every few weeks. The mirror forgets; the photos don’t.')}</div>}
  </div>
}

/* ---------- strength balance ---------- */
export function BalanceCard({ S }) {
  const rows = strengthBalance(S)
  if (!rows) return null
  const lag = rows.filter(r => r.behind).sort((a, b) => a.pct - b.pct)[0]
  return <div className="card">
    <h2>{t('Strength balance')}</h2>
    <div className="small" style={{ marginBottom: 10 }}>{lag
      ? t('{0} is lagging: about {1} to catch up', t(lag.name), fmtNum(lag.gap) + ' ' + S.unit)
      : t('Your main lifts are in balance')}</div>
    {rows.map(r => <div key={r.key} style={{ marginBottom: 8 }}>
      <div className="row between small"><span>{t(r.name)}</span><span className="muted">{fmtNum(r.e1rm)} {S.unit} · {r.pct}%</span></div>
      <div className="bal-bar"><span style={{ width: r.pct + '%', background: r.behind ? 'var(--orange)' : 'var(--acc)' }} /></div>
    </div>)}
    <div className="small dim" style={{ marginTop: 6 }}>{t('Estimated 1RMs from the last 4 months against classic proportions: squat 100%, deadlift 120%, bench 75%, row 52%, overhead press 45%.')}</div>
  </div>
}

/* ---------- month recap ---------- */
const ymOf = d => isoOf(d).slice(0, 7)
function prevYM() { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return ymOf(d) }
const monthName = ym => new Date(ym + '-15T12:00:00').toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })

function drawRecap(S, ym, r) {
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350
  const g = c.getContext('2d')
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim()
  g.fillStyle = '#0b0b0c'; g.fillRect(0, 0, 1080, 1350)
  g.fillStyle = css('--acc') || '#30d158'
  g.font = '600 44px system-ui, sans-serif'; g.fillText('openGym', 90, 140)
  g.fillStyle = '#fff'; g.font = '700 96px system-ui, sans-serif'; g.fillText(monthName(ym), 90, 270)
  const cells = [
    [r.n, t('Workouts')], [r.sets, t('Sets')],
    [fmtNum(r.vol), t('Volume') + ' (' + S.unit + ')'], [Math.round(r.min / 60 * 10) / 10 + ' h', t('Time trained')],
    [r.prs, t('PRs')], [r.days, t('Days trained')],
  ]
  cells.forEach(([v, l], i) => {
    const x = 90 + (i % 2) * 460, y = 460 + Math.floor(i / 2) * 230
    g.fillStyle = '#fff'; g.font = '700 110px system-ui, sans-serif'; g.fillText(String(v), x, y)
    g.fillStyle = '#9a9aa0'; g.font = '500 40px system-ui, sans-serif'; g.fillText(l, x, y + 60)
  })
  if (r.topEx) {
    g.fillStyle = '#9a9aa0'; g.font = '500 40px system-ui, sans-serif'; g.fillText(t('Most trained'), 90, 1180)
    g.fillStyle = '#fff'; g.font = '600 54px system-ui, sans-serif'; g.fillText(((EXIDX[r.topEx] || {}).n || '').replace(/^./, ch => ch.toUpperCase()), 90, 1250, 900)
  }
  return new Promise(res => c.toBlob(res, 'image/png'))
}

export function RecapCard({ S }) {
  const months = [ymOf(new Date()), prevYM()]
  const [ym, setYm] = useState(months[0])
  const r = monthRecap(S, ym)
  const share = async () => {
    const blob = await drawRecap(S, ym, r)
    const file = new File([blob], `opengym-${ym}.png`, { type: 'image/png' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file] }).catch(() => {})
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click()
  }
  return <div className="card">
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Month recap')}</h2>
      <Button size="sm" icon="upload" disabled={!r.n} onClick={share}>{t('Share')}</Button>
    </div>
    <div className="sect-b" style={{ marginBottom: 10 }}>
      <SelectRow title={t('Month')} sheetTitle={t('Month recap')} value={ym} onChange={setYm} options={months.map(m => ({ value: m, label: monthName(m) }))} />
    </div>
    {r.n ? <div className="tiles">
      <div className="tile"><div className="l">{t('Workouts')}</div><div className="v">{r.n}</div></div>
      <div className="tile"><div className="l">{t('Sets')}</div><div className="v">{r.sets}</div></div>
      <div className="tile"><div className="l">{t('Volume')}</div><div className="v" style={{ fontSize: 22 }}>{fmtVol(r.vol, S.unit)}</div></div>
      <div className="tile"><div className="l">{t('PRs')}</div><div className="v">{r.prs}</div></div>
    </div> : <div className="muted small">{t('No workouts in {0} yet.', monthName(ym))}</div>}
  </div>
}
