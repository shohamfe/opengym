// Settings › Profile (design.md §2.5): every onboarding answer, editable.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { lastBW } from '../lib/history.js'
import { dueValid, weeksOf, cmToFtIn } from '../lib/profile.js'
import { bwSheet } from '../sheets.jsx'
import { Section, Row, SelectRow, Segmented, Button, TextField } from '../components/ui.jsx'
import { PregFields, HeightInput, TRAINING } from './Onboarding.jsx'

const BLANK = { name: '', sex: 'na', heightCm: null, exp: null, preg: null }
const setP = patch => useStore.getState().update(s => { s.profile = { ...BLANK, ...s.profile, ...patch, at: Date.now() } })
const ui = () => useUI.getState()

export default function ProfileSection() {
  const S = useStore(s => s.S)
  const P = { ...BLANK, ...S.profile }
  const bw = lastBW(S)
  const heightTxt = P.heightCm == null ? t('Not set')
    : S.unit === 'lb' ? cmToFtIn(P.heightCm).join('′ ') + '″' : P.heightCm + ' cm'
  const wk = P.preg && dueValid(P.preg.due) ? weeksOf(P.preg.due) : null
  const setSex = v => {
    setP({ sex: v, ...(v === 'female' ? {} : { preg: null }) })
    if (v === 'female' && !P.preg) ui().toast(t('Pregnancy marks can be turned on in Profile › Pregnancy'))
  }
  return <Section title={t('Profile')} footer={t('Used for the body diagram, exercise pictures and pregnancy marks. Stored in your account.')}>
    <Row icon="person" iconTint="var(--blue)" title={t('Name')} value={P.name || t('Not set')} accessory="chevron"
      onClick={() => ui().openSheet(close => <NameSheet close={close} name={P.name} />)} />
    <SelectRow icon="figureStrength" iconTint="var(--teal)" title={t('Body')} value={P.sex} onChange={setSex}
      options={[{ value: 'female', label: t('Female') }, { value: 'male', label: t('Male') }, { value: 'na', label: t('Not set') }]} />
    <Row icon="scale" iconTint="var(--teal)" title={t('Weight')} value={bw ? fmtNum(bw.w) + ' ' + S.unit : t('Not set')} accessory="chevron" onClick={() => bwSheet()} />
    <Row icon="target" iconTint="var(--purple)" title={t('Height')} value={heightTxt} accessory="chevron"
      onClick={() => ui().openSheet(close => <HeightSheet close={close} cm={P.heightCm} unit={S.unit} />)} />
    <SelectRow icon="barbell" iconTint="var(--orange)" title={t('Training')} value={P.exp} onChange={v => setP({ exp: v })}
      options={TRAINING()} />
    {P.sex === 'female' && <Row icon="heart" iconTint="var(--pink)" title={t('Pregnancy')} accessory="chevron"
      value={wk != null ? t('Week {0}', Math.max(0, wk)) : t('Off')}
      onClick={() => ui().openSheet(close => <PregSheet close={close} preg={P.preg} />)} />}
  </Section>
}

function NameSheet({ close, name }) {
  const [v, setV] = useState(name || '')
  const save = () => { if (!v.trim()) return; setP({ name: v.trim().slice(0, 40) }); close() }
  return <>
    <h3>{t('Name')}</h3>
    <TextField value={v} maxLength={40} autoFocus autoCapitalize="words" placeholder={t('Your name')}
      onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={!v.trim()} onClick={save}>{t('Save')}</Button>
  </>
}

function HeightSheet({ close, cm, unit }) {
  const [v, setV] = useState(cm)
  return <>
    <h3>{t('Height')}</h3>
    <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0 16px' }}>
      <HeightInput cm={v} unit={unit} onChange={setV} />
    </div>
    <Button variant="primary" onClick={() => { setP({ heightCm: v ?? 170 }); close() }}>{t('Save')}</Button>
    {cm != null && <><div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => { setP({ heightCm: null }); close() }}>{t('Clear')}</Button></>}
  </>
}

function PregSheet({ close, preg }) {
  const [on, setOn] = useState(!!preg)
  const [p, setPr] = useState(preg || { due: '', clear: null, clearAt: null, twins: null })
  const ok = !on || (dueValid(p.due) && !!p.clear)
  const save = () => {
    setP({ preg: on ? { ...p, clearAt: p.clearAt || Date.now() } : null })
    // PM §11 / QA C18: turning it off also drops the device's one-slot backups that hold the date.
    if (!on) { try { localStorage.removeItem('gym_backup_v1'); localStorage.removeItem('gym_unit_backup') } catch { /* */ } }
    close()
  }
  return <>
    <h3>{t('Pregnancy')}</h3>
    <Segmented options={[{ value: true, label: t('Pregnant') }, { value: false, label: t('Not pregnant') }]} value={on} onChange={setOn} />
    <div style={{ height: 16 }} />
    {on ? <PregFields p={p} onChange={patch => setPr(o => ({ ...o, ...patch }))} />
      : <p className="sect-f" style={{ marginBottom: 12 }}>{t('Turning this off removes your due date.')}</p>}
    <div className="sheet-foot"><Button variant="primary" disabled={!ok} onClick={save}>{t('Save')}</Button></div>
  </>
}
