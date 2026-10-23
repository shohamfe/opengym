// First-run profile (design.md §2.2): a full-screen stepper, not a sheet, so it can't be swiped
// away. Shown once per account, after the first sync, while S.profile is null (lib/profile.js
// needsOnboarding). Name → about you → pregnancy (women only) → body & training → how to start.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { lastBW } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { convertState } from '../lib/units.js'
import { dueRange, dueValid, dueFromWeeks, weeksOf, cmToFtIn, ftInToCm } from '../lib/profile.js'
import { WeightInput, loadStarterPlan, loadPregnancyStarter, openPlanFile } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Section, Row, Segmented, Switch, Button, TextField, Stepper, NumberField } from '../components/ui.jsx'

// Single-select list of big rows (56px) with a check on the chosen one.
export function Choice({ options, value, onChange }) {
  return <Section>
    {options.map(o => <Row key={o.value} title={o.label} subtitle={o.subtitle} className="onb-opt"
      accessory={o.value === value ? 'check' : 'none'} onClick={() => onChange(o.value)} />)}
  </Section>
}

export const TRAINING = () => [
  { value: 'none', label: t('New to it') },
  { value: 'some', label: t('Some (cardio or < 1 year lifting)') },
  { value: 'regular', label: t('Regular strength training') },
]
export const CLEARANCE = () => [
  { value: 'yes', label: t('Yes, my doctor or midwife said exercise is OK') },
  { value: 'limits', label: t('Yes, with some limits') },
  { value: 'notyet', label: t('Not yet') },
]
const CLEAR_NOTE = {
  limits: 'Follow your provider’s limits. Badges are general guidance.',
  notyet: 'Not cleared yet. Ask your doctor or midwife at your next visit. Until then: Good picks, light effort.',
}

// Due date (or weeks, as an input method only), clearance and twins. `p` is the
// S.profile.preg shape; onChange gets a patch.
export function PregFields({ p, onChange }) {
  const [byWeeks, setByWeeks] = useState(false)
  const { min, max } = dueRange()
  const ok = dueValid(p.due)
  const wk = ok ? weeksOf(p.due) : null
  return <>
    <Section title={t('Due date')} footer={ok ? t('Week {0} · trimester {1}', Math.max(0, wk), wk < 14 ? 1 : wk < 28 ? 2 : 3) : null}>
      {byWeeks
        ? <Row icon="calendar" iconTint="var(--pink)" title={t('Weeks pregnant')}>
            <Stepper value={ok ? Math.max(0, Math.min(42, wk)) : 20} decimal={false}
              onChange={w => onChange({ due: dueFromWeeks(w) })} />
          </Row>
        : <Row icon="calendar" iconTint="var(--pink)" title={t('Due date')}>
            <input type="date" className="timef" min={min} max={max} value={p.due || ''}
              aria-label={t('Due date')} onChange={e => onChange({ due: e.target.value })} />
          </Row>}
    </Section>
    {p.due && !ok && <p className="sect-f" style={{ marginTop: -16, marginBottom: 16, color: 'var(--red)' }}>{t('Pick a date between two weeks ago and 40 weeks from now.')}</p>}
    {!byWeeks && <Button variant="ghost" size="sm" onClick={() => { setByWeeks(true); if (!ok) onChange({ due: dueFromWeeks(20) }) }}>{t('Don’t know the date? Enter weeks instead')}</Button>}
    <h2 className="sect-t" style={{ marginTop: 18 }}>{t('Has your doctor or midwife cleared you to exercise?')}</h2>
    <Choice options={CLEARANCE()} value={p.clear} onChange={v => onChange({ clear: v, clearAt: Date.now() })} />
    {CLEAR_NOTE[p.clear] && <p className="sect-f" style={{ marginTop: -16, marginBottom: 16 }}>{t(CLEAR_NOTE[p.clear])}</p>}
    <p className="sect-f" style={{ marginTop: -8, marginBottom: 16 }}>{t('If your provider told you not to exercise, follow that. Everyday activity like walking is usually fine.')}</p>
    <Section footer={t('Optional.')}>
      <Row icon="heart" iconTint="var(--pink)" title={t('Twins or more')}>
        <Switch checked={!!p.twins} onChange={v => onChange({ twins: v })} />
      </Row>
    </Section>
  </>
}

// Height in cm, or ft + in when the profile weighs in pounds. Stored as cm.
export function HeightInput({ cm, unit, onChange }) {
  if (unit !== 'lb') return <Stepper value={cm ?? 170} decimal={false} unit="cm" onChange={v => onChange(v || null)} />
  const [ft, inch] = cmToFtIn(cm ?? 170)
  return <div className="row" style={{ gap: 10 }}>
    <NumberField className="hfield" decimal={false} value={ft} aria-label="ft" onChange={v => onChange(ftInToCm(v, inch))} /><span className="dim">ft</span>
    <NumberField className="hfield" decimal={false} value={inch} aria-label="in" onChange={v => onChange(ftInToCm(ft, Math.min(11, v || 0)))} /><span className="dim">in</span>
  </div>
}

export default function Onboarding() {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const update = useStore(s => s.update)
  const fileRef = useRef(null)
  const existing = !!(S.routines.length || S.workouts.length)   // Shoham: already has a plan
  const emailName = (user?.name || '').split('@')[0]
  const [d, setD] = useState(() => ({
    name: emailName ? emailName[0].toUpperCase() + emailName.slice(1) : '',
    sex: null, pregAns: null, preg: { due: '', clear: null, clearAt: null, twins: null },
    unit: S.unit, weight: null, heightCm: null, exp: null,
  }))
  const set = patch => setD(o => ({ ...o, ...patch }))
  const steps = ['name', 'sex', ...(d.sex === 'female' ? ['preg'] : []), 'body', 'done']
  const [i, setI] = useState(0)
  const step = steps[i]
  const pregnant = d.sex === 'female' && d.pregAns === 'yes'
  useEffect(() => {
    document.body.classList.add('notabs')
    return () => document.body.classList.remove('notabs')
  }, [])
  useEffect(() => { window.scrollTo(0, 0) }, [i])

  const valid = step === 'name' ? !!d.name.trim()
    : step === 'sex' ? !!d.sex
    : step === 'preg' ? !!d.pregAns && (d.pregAns !== 'yes' || (dueValid(d.preg.due) && !!d.preg.clear))
    : true
  const next = () => valid && setI(i + 1)

  // Writes everything at once; `then` runs the start choice on the saved state.
  const finish = then => {
    update(s => {
      if (d.unit !== s.unit) convertState(s, d.unit)
      if (d.weight) {
        const local = todayISO()
        const ex = s.bodyweight.find(b => b.d === local)
        if (ex) { ex.w = d.weight; ex.t = Date.now() } else s.bodyweight.push({ d: local, w: d.weight, t: Date.now() })
        s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
      }
      s.profile = {
        name: d.name.trim().slice(0, 40), sex: d.sex, heightCm: d.heightCm, exp: d.exp,
        preg: pregnant ? { ...d.preg, clearAt: d.preg.clearAt || Date.now() } : null, at: Date.now(),
      }
      // QA D2: a diagram someone set to Female by hand stays Female.
      if (s.body === 'female' && !s.bodyPick && d.sex !== 'female') s.bodyPick = 'female'
    })
    then && then()
  }

  const bw = lastBW(S)
  const wShown = d.weight ?? (bw && d.unit === S.unit ? bw.w : d.unit === 'lb' ? 155 : 70)

  return <div className="narrow onb">
    <div className="hdr onb-hdr">
      {i > 0 ? <button className="iconbtn" onClick={() => setI(i - 1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button> : <span className="onb-sp" />}
      <div className="onb-dots" role="img" aria-label={t('Step {0} of {1}', i + 1, steps.length)}>
        {steps.map((s, k) => <span key={s} className={k <= i ? 'on' : ''} />)}
      </div>
      {step === 'body' ? <Button variant="ghost" size="sm" onClick={() => { set({ weight: null, heightCm: null, exp: null }); setI(i + 1) }}>{t('Skip')}</Button> : <span className="onb-sp" />}
    </div>

    {step === 'name' && <>
      <h1 className="onb-h">{t('What should we call you?')}</h1>
      <div className="onb-sub">{t('Shown on Home.')}</div>
      <TextField placeholder={t('Your name')} maxLength={40} autoFocus autoCapitalize="words" autoComplete="given-name"
        value={d.name} onChange={e => set({ name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') next() }} />
    </>}

    {step === 'sex' && <>
      <h1 className="onb-h">{t('About you')}</h1>
      <div className="onb-sub">{t('Sets the body diagram and exercise pictures.')}</div>
      <Choice value={d.sex} onChange={v => set({ sex: v })} options={[
        { value: 'female', label: t('Female') }, { value: 'male', label: t('Male') }, { value: 'na', label: t('Prefer not to say') }]} />
    </>}

    {step === 'preg' && <>
      <h1 className="onb-h">{t('Are you pregnant?')}</h1>
      <div className="onb-sub">{t('We’ll mark exercises to avoid, take care with, or that suit pregnancy. It’s general guidance.')}</div>
      <Choice value={d.pregAns} onChange={v => set({ pregAns: v })} options={[
        { value: 'yes', label: t('Yes') }, { value: 'no', label: t('No') }, { value: 'na', label: t('Prefer not to say') }]} />
      {d.pregAns === 'yes' && <PregFields p={d.preg} onChange={patch => set({ preg: { ...d.preg, ...patch } })} />}
      <div className="dim small" style={{ marginTop: 8, lineHeight: 1.45 }}>{t('openGym isn’t medical advice.')} {t('Your data is stored on openGym’s server; the app’s admin can technically see it.')}</div>
    </>}

    {step === 'body' && <>
      <h1 className="onb-h">{t('Your body')}</h1>
      <div className="onb-sub">{t('Optional. Helps track progress and plan starting weights.')}</div>
      <Section>
        <Row icon="scale" iconTint="var(--teal)" title={t('Weight unit')}>
          <Segmented className="seg-inline" options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
            value={d.unit} onChange={v => set({ unit: v, weight: null })} />
        </Row>
      </Section>
      <h2 className="sect-t">{t('Weight')}</h2>
      <div className={'onb-w' + (d.weight == null ? ' untouched' : '')}>
        <WeightInput value={wShown} setValue={v => set({ weight: v })} unit={d.unit} />
      </div>
      <Section title={t('Height')}>
        <Row icon="target" iconTint="var(--purple)" title={t('Height')}>
          <HeightInput cm={d.heightCm} unit={d.unit} onChange={v => set({ heightCm: v })} />
        </Row>
      </Section>
      <h2 className="sect-t">{pregnant ? t('Training before pregnancy') : t('Training')}</h2>
      <Choice options={TRAINING()} value={d.exp} onChange={v => set({ exp: v })} />
    </>}

    {step === 'done' && <>
      <h1 className="onb-h">{t('You’re set, {0}', d.name.trim())}</h1>
      {existing ? <>
        <div className="onb-sub">{t('Your plan and workouts are all still here.')}</div>
        <Button variant="primary" onClick={() => finish()}>{t('Done')}</Button>
      </> : <>
        <div className="onb-sub">{t('How do you want to start?')}</div>
        <Section>
          {pregnant
            ? <Row icon="sparkles" iconTint="var(--acc)" title={t('Pregnancy starter plan')} subtitle={t('2 days, full body, good picks')} accessory="chevron" onClick={() => finish(loadPregnancyStarter)} />
            : <Row icon="sparkles" iconTint="var(--acc)" title={t('Starter plan')} subtitle={t('Push / Pull / Legs, 3 days')} accessory="chevron" onClick={() => finish(loadStarterPlan)} />}
          <Row icon="upload" iconTint="var(--blue)" title={t('Import a plan')} subtitle={t('A plan file someone shared with you')} accessory="chevron" onClick={() => fileRef.current.click()} />
          <Row icon="plus" iconTint="var(--grey)" title={t('Start empty')} accessory="chevron" onClick={() => finish()} />
        </Section>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden
          onChange={ev => { const f = ev.target.files[0]; ev.target.value = ''; if (f) finish(() => openPlanFile(f)) }} />
      </>}
    </>}

    {step !== 'done' && <div className="onb-foot">
      <Button variant="primary" disabled={!valid} onClick={next}>{t('Continue')}</Button>
    </div>}
  </div>
}
