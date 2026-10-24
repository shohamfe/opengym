import { useNavigate, useParams } from 'react-router-dom'
import { back } from '../lib/nav.js'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { exOr } from '../lib/exercises.js'
import { uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { supersetUnits, cleanupSg, exLine, reorder, swapConfig } from '../lib/history.js'
import { Thumb } from '../components/Media.jsx'
import { glyphPicker, exercisePicker, exConfigSheet, confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { Button, SelectRow } from '../components/ui.jsx'
import { POLICIES_FOR, POLICY_NAME, POLICY_DESC } from '../lib/progression.js'
import BodyMap from '../components/BodyMap.jsx'
import { PgBadge } from '../components/Pregnancy.jsx'
import { labelOf } from '../lib/pregnancy.js'
import { loadOfRoutine, rankOf, MUSCLE_NAME } from '../lib/muscles.js'
import { bodyOf } from '../lib/profile.js'

export default function RoutineEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const r = S.routines.find(x => x.id === id)
  const listRef = useRef(null)
  const [drag, setDrag] = useState(null)   // { from, to, y0, dy, h, mids } while a grip is held
  useEffect(() => { if (!r) nav('/plan') }, [!!r])
  if (!r) return null

  const edit = fn => update(s => { fn(s.routines.find(x => x.id === id).ex) })
  // Rows are keyed by index, so send focus after the moved exercise or a second press undoes the first.
  const move = (i, dir) => {
    edit(ex => reorder(ex, i, i + dir))
    const j = Math.max(0, Math.min(r.ex.length - 1, i + dir))
    requestAnimationFrame(() => listRef.current?.children[j]?.querySelectorAll('.sr-move button')[dir < 0 ? 0 : 1]?.focus())
  }
  // Target = how many other rows' midpoints the dragged row's centre has passed.
  const dragAt = (d, y) => { const dy = y - d.y0, c = d.mids[d.from] + dy; return { ...d, dy, to: d.mids.filter((m, k) => k !== d.from && m < c).length } }
  const grip = i => ({
    onClick: ev => ev.stopPropagation(),
    onPointerDown: ev => {
      ev.stopPropagation(); ev.currentTarget.setPointerCapture(ev.pointerId)
      const rows = [...listRef.current.children].map(n => n.getBoundingClientRect())
      setDrag({ from: i, to: i, y0: ev.clientY, dy: 0, h: rows[i].height + 8, mids: rows.map(b => b.top + b.height / 2) })
    },
    onPointerMove: ev => { if (!drag) return; ev.preventDefault(); const y = ev.clientY; setDrag(d => d && dragAt(d, y)) },
    onPointerUp: ev => { if (!drag) return; const { from, to } = dragAt(drag, ev.clientY); setDrag(null); if (from !== to) edit(x => reorder(x, from, to)) },
    onPointerCancel: () => setDrag(null),
  })
  const shiftOf = i => !drag ? 0 : i === drag.from ? drag.dy
    : drag.from < drag.to ? (i > drag.from && i <= drag.to ? -drag.h : 0) : (i >= drag.to && i < drag.from ? drag.h : 0)
  // Swap opens the picker, then the config prefilled from this row; the row changes only on Save.
  // `done` closes the swap picker(s) underneath once the row changes, so they can't swap it again.
  const openRow = (i, ex, cfg, done) => exConfigSheet(ex, cfg, c => { done?.(); edit(x => { x[i] = { id: ex.id, sg: x[i].sg, ...c } }) }, () => { done?.(); edit(x => { x.splice(i, 1); cleanupSg(x) }) }, r,
    () => { const p = exercisePicker(n => openRow(i, n, swapConfig(cfg, ex, n), () => { p.close(); done?.() }), { like: ex }) })
  const toggleLink = i => edit(ex => {
    if (i < 1) return
    const cur = ex[i], prev = ex[i - 1]
    if (cur.sg && prev.sg && cur.sg === prev.sg) delete cur.sg
    else { const gid = prev.sg || ('sg' + uid()); prev.sg = gid; cur.sg = gid }
    cleanupSg(ex)
  })

  const units = supersetUnits(r.ex)
  const inSS = new Set(units.filter(u => u.length > 1).flat())

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => back('/plan')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <input className="input" defaultValue={r.name} style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}
          onChange={e => update(s => { s.routines.find(x => x.id === id).name = e.target.value.trim() || t('Routine') })} />
      </div>
      <button className="iconbtn" aria-label={t('Pick an icon')} onClick={() => glyphPicker(r.emoji, g => update(s => { s.routines.find(x => x.id === id).emoji = g }))}><Icon name={glyphOf(r.emoji)} /></button>
    </div>

    <div className="sect-b" style={{ marginBottom: 16 }}>
      <SelectRow icon="chartLine" title={t('Progression')} sheetTitle={t('Progression')}
        value={r.prog || 'linear'} onChange={v => update(s => { s.routines.find(x => x.id === id).prog = v })}
        options={POLICIES_FOR.reps.map(p => ({ value: p, label: t(POLICY_NAME[p]), subtitle: t(POLICY_DESC[p]) }))} />
    </div>
    <div className="small dim" style={{ margin: '-10px 2px 16px' }}>
      {t('Applies to every exercise in this routine that does not set its own rule.')}
    </div>

    {(() => {
      const n = r.ex.filter(e => labelOf(e.id, S) === 'avoid').length
      return n > 0 && <div className="progline warn pgline" style={{ marginBottom: 10 }}><Icon name="warn" /><span>
        {n === 1 ? t('1 exercise is usually avoided in pregnancy') : t('{0} exercises are usually avoided in pregnancy', n)}</span></div>
    })()}
    {r.ex.length ? <div className={'list' + (drag ? ' reordering' : '')} ref={listRef}>{r.ex.map((e, i) => {
      // An unresolvable id is shown rather than skipped — hiding it left an entry you
      // could neither see nor delete, but that still turned up in the workout.
      const ex = exOr(e.id)
      const linkedPrev = i > 0 && e.sg && r.ex[i - 1].sg === e.sg
      return <div key={i} className={drag?.from === i ? 'dragging' : undefined} style={drag ? { transform: `translateY(${shiftOf(i)}px)` } : undefined}>
        {/* the link between two rows lives between them, labelled, instead of a bare icon on the row */}
        {i > 0 && <button className={'sslink' + (linkedPrev ? ' on' : '')} aria-pressed={!!linkedPrev} onClick={() => toggleLink(i)}>
          <Icon name="link" />{linkedPrev ? t('Superset · tap to unlink') : t('Link as superset')}</button>}
        <div className={'item' + (inSS.has(i) ? ' in-ss' : '')} onClick={() => openRow(i, ex, e)}>
          {r.ex.length > 1 && <div className="iconbtn grip" aria-hidden="true" {...grip(i)}><Icon name="grip" /></div>}
          <Thumb ex={ex} />
          <div className="grow"><div className="tt capitalize">{ex.n}</div><div className="ss"><PgBadge id={e.id} />{exLine(e, S.unit)}</div></div>
          <Icon name="chevronRight" className="chev" />
          <div style={{ display: 'contents' }}>
            {/* Visually hidden until tabbed to: the keyboard / screen-reader way to reorder. */}
            {r.ex.length > 1 && <div className="sr-move" style={{ gap: 2 }}>
              <button className="iconbtn" aria-label={t('Move {0} up', ex.n)} style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }} onClick={ev => { ev.stopPropagation(); move(i, -1) }}><Icon name="chevronUp" /></button>
              <button className="iconbtn" aria-label={t('Move {0} down', ex.n)} style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }} onClick={ev => { ev.stopPropagation(); move(i, 1) }}><Icon name="chevronDown" /></button>
            </div>}
          </div>
        </div>
      </div>
    })}</div> : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No exercises yet — add your first one.')}</div>}

    {/* Coverage of the routine as planned, so a gap shows up while you're building it
        rather than after a month of training around it. */}
    {r.ex.length > 0 && (() => {
      const load = loadOfRoutine(r)
      const { worked } = rankOf(load)
      return <div className="card" style={{ marginTop: 12 }}>
        <h2>{t('What this session hits')}</h2>
        <BodyMap load={load} body={bodyOf(S)} />
        <div className="mchips">
          {worked.slice(0, 6).map(m => <span key={m} className="mchip">{t(MUSCLE_NAME[m])}</span>)}
        </div>
      </div>
    })()}

    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={() => { const p = exercisePicker(ex => exConfigSheet(ex, null, cfg => { p.close(); edit(x => { x.push({ id: ex.id, ...cfg }) }) }, null, r)) }} icon="plus">{t('Add exercise')}</Button>
    <div style={{ height: 10 }} />
    <Button variant="danger" onClick={() => confirmSheet({
      title: t('Delete routine?'), message: t('“{0}” and its exercises will be removed.', r.name), confirmText: t('Delete'), danger: true,
      onConfirm: () => {
        update(s => {
          s.routines = s.routines.filter(x => x.id !== id)
          Object.keys(s.week).forEach(k => { if (s.week[k] === id) delete s.week[k] })
          Object.keys(s.dayPlan).forEach(k => { if (s.dayPlan[k] === id) delete s.dayPlan[k] })
        })
        nav('/plan')
      }
    })}>{t('Delete routine')}</Button>
  </div>
}
