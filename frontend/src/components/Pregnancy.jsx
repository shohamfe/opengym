// Pregnancy UI (design.md 2.3 / 2.4, coach-pregnancy.md): one badge, one info sheet, the
// Gentle mode line. Everything renders nothing unless pregOf(S) is set.
import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { pregOf, labelOf, reasonOf, gentle } from '../lib/pregnancy.js'
import { fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Button, Section, Row } from './ui.jsx'

// Internal keys stay avoid/caution/rec; users only ever see these words (QA D1).
export const PG_WORD = { avoid: 'Avoid', caution: 'Take care', rec: 'Good pick' }
const PG_CLS = { avoid: 'avoid', caution: 'care', rec: 'good' }
const PG_ICON = { avoid: 'xmark', caution: 'warn', rec: 'check' }

/** The badge. `button` makes it a 40px target that opens the sheet (live workout, sheets). */
export function PgBadge({ id, button }) {
  const S = useStore(s => s.S)
  const level = labelOf(id, S)
  if (!level) return null
  const inner = <><Icon name={PG_ICON[level]} />{t(PG_WORD[level])}</>
  if (!button) return <span className={'tag pg ' + PG_CLS[level]}>{inner}</span>
  return <button className={'tag pg pgbtn ' + PG_CLS[level]} onClick={e => { e.stopPropagation(); pregnancySheet(exOr(id)) }}
    aria-label={t(PG_WORD[level]) + ': ' + t(reasonOf(id, S))}>{inner}</button>
}

const SIGNS = [
  'Bleeding from the vagina', 'Regular, painful contractions', 'Fluid leaking from the vagina',
  'Short of breath before you start', "Dizzy or faint, and it doesn't pass", 'Headache', 'Chest pain',
  'Muscle weakness affecting balance', 'Pain or swelling in your calf', 'Your baby moving less than usual'
]
const NOGO = [
  'Waters broken, or labour starting early', 'Bleeding that keeps coming back or has no clear cause',
  'Placenta lying low after 26 weeks', 'Pre-eclampsia or high blood pressure', 'A weak cervix or a stitch (cerclage)',
  'Baby not growing as expected', 'Serious heart or lung disease, or uncontrolled diabetes or thyroid disease'
]
const TRI = { 1: '1st trimester', 2: '2nd trimester', 3: '3rd trimester' }

function PregnancySheet({ ex, at }) {
  const S = useStore(s => s.S)
  const p = pregOf(S)
  useEffect(() => { if (at) document.getElementById('pg-' + at)?.scrollIntoView({ block: 'start' }) }, [at])
  if (!p) return null
  const level = ex && labelOf(ex.id, S)
  return <>
    {level && <div style={{ marginBottom: 16 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <PgBadge id={ex.id} /><h3 className="capitalize" style={{ margin: 0, fontSize: 17 }}>{ex.n}</h3>
      </div>
      <div className={'exnote pgnote ' + PG_CLS[level]}>{t(reasonOf(ex.id, S))}</div>
    </div>}
    <h3 style={{ marginBottom: 2 }}>{t('Week {0} · {1}', p.week, t(TRI[p.tri]))}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Due {0}', fmtDate(p.due, true))}</div>
    <div id="pg-warn" />
    <Section title={<span style={{ color: 'var(--red-t)' }}>{t('Stop and call your doctor or midwife if…')}</span>}
      footer={t('Also stop the exercise if you feel pelvic pain, new leaking, or heaviness, and mention it to your midwife.')}>
      {SIGNS.map(s => <Row key={s} icon="dot" iconTint="var(--red-t)" title={t(s)} />)}
    </Section>
    <Section title={t('What the marks mean')}>
      <Row title={<span className="tag pg avoid"><Icon name="xmark" />{t('Avoid')}</span>} subtitle={t('Usually avoided at this stage.')} />
      <Row title={<span className="tag pg care"><Icon name="warn" />{t('Take care')}</span>} subtitle={t('OK if it feels fine; an easier version is often better.')} />
      <Row title={<span className="tag pg good"><Icon name="check" />{t('Good pick')}</span>} subtitle={t('Suits pregnancy well.')} />
      <Row title={t('No mark')} subtitle={t('Nothing specific; listen to your body.')} />
    </Section>
    <Section title={t('Good to know')}>
      <Row icon="heart" iconTint="var(--acc)" title={t('Aim for about 150 min of moderate activity a week; you should still be able to talk.')} />
      <Row icon="moon" iconTint="var(--blue)" title={t('Feel light-headed lying on your back? Roll onto your side.')} />
      <Row icon="lightbulb" iconTint="var(--yellow)" title={t('Leave 2-3 reps in the tank during pregnancy.')} />
    </Section>
    <div id="pg-before" />
    <Section title={t('Before you start')} footer={t("If any of these apply, structured exercise isn't advised. Everyday activity like walking is usually fine. Follow your provider.")}>
      {NOGO.map(s => <Row key={s} icon="dot" iconTint="var(--label-3)" title={t(s)} />)}
    </Section>
    <div className="dim small" style={{ textAlign: 'center', margin: '4px 0 8px' }}>{t("openGym isn't medical advice. Your doctor or midwife's advice comes first.")}</div>
  </>
}
/** ex: exercise mode (badge + reason first). at: 'warn' | 'before' scrolls there. */
export const pregnancySheet = (ex, at) => useUI.getState().openSheet(() => <PregnancySheet ex={ex} at={at} />, { label: t('Pregnancy guide') })

/** Gentle mode line (Home, workout). `ask`: the 14-day "Got the OK?" card for "Not yet". */
export function PregLine({ ask }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  if (!pregOf(S)) return null
  const pr = S.profile.preg
  const reask = ask && pr.clear === 'notyet' && Date.now() - (pr.clearAt || 0) >= 14 * 86400000
  const set = clear => update(s => { s.profile.preg.clear = clear; s.profile.preg.clearAt = Date.now() })
  return <>
    {reask && <div className="card">
      <h2>{t('Got the OK from your provider?')}</h2>
      <div className="col" style={{ display: 'grid', gap: 8 }}>
        <Button variant="primary" onClick={() => set('yes')}>{t('Yes, exercise is OK')}</Button>
        <Button onClick={() => set('limits')}>{t('Yes, with some limits')}</Button>
        <Button variant="ghost" onClick={() => set('notyet')}>{t('Not yet')}</Button>
      </div>
    </div>}
    {pr.clear !== 'yes' && <button className="progline warn pgline" onClick={() => pregnancySheet(null, 'before')}>
      <Icon name="heart" /><span>{pr.clear === 'notyet'
        ? t('Not cleared yet. Ask your doctor or midwife at your next visit. Until then: Good picks, light effort.')
        : t("Follow your provider's limits. Badges are general guidance.")}</span>
    </button>}
  </>
}

/** The talk-test tip shown when a session starts in Gentle mode. */
export function GentleTip() {
  const S = useStore(s => s.S)
  if (!gentle(S)) return null
  return <div className="progline"><Icon name="lightbulb" /><span>{t('Talk-test pace. Stop if anything feels wrong.')}</span></div>
}
