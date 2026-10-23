// Supabase build, Settings: the admin's "Members & invites" card and "Delete account". Every RPC
// here checks the caller on the server (supabase/migrations/20261023_accounts.sql); hiding the
// card from non-admins is only cosmetic.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { accountRpc } from '../lib/supabaseSync.js'
import { fmtCode } from '../lib/codes.js'
import { t, dateLocale } from '../lib/i18n.js'
import { confirmSheet } from '../sheets.jsx'
import { Section, Row, Button } from '../components/ui.jsx'

const toast = m => useUI.getState().toast(m)
const day = ts => new Date(ts).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })
const STATUS = { open: 'Open', used: 'Used', expired: 'Expired', revoked: 'Revoked' }

export function MembersCard() {
  const user = useStore(s => s.user)
  const [admin, setAdmin] = useState(false)
  const [invites, setInvites] = useState([])
  const [members, setMembers] = useState([])
  const load = () => Promise.all([accountRpc('gym_invite_list'), accountRpc('gym_admin_users')])
    .then(([i, m]) => { setInvites(i || []); setMembers(m || []) })
    .catch(() => toast(t('Could not load members. Check your connection.')))
  useEffect(() => {
    setAdmin(false)
    if (user) accountRpc('gym_is_admin').then(a => { setAdmin(!!a); if (a) load() }).catch(() => {})
  }, [user?.id])
  if (!admin) return null

  const newInvite = () => useUI.getState().openSheet(close => <InviteSheet close={close} onMade={load} />)
  const revoke = i => confirmSheet({
    title: t('Revoke this invite?'), message: t('The code stops working. Nobody has used it yet.'), confirmText: t('Revoke'), danger: true,
    onConfirm: () => accountRpc('gym_invite_revoke', { id: i.id }).then(load, () => toast(t('Could not revoke the invite.')))
  })
  const resetFor = m => confirmSheet({
    title: t('Make a reset code?'), message: t('For {0}. They enter it under “Forgot password?” to choose a new password.', m.email), confirmText: t('Make code'),
    onConfirm: () => accountRpc('gym_reset_mint', { user_id: m.user_id })
      .then(code => useUI.getState().openSheet(() => <CodeSheet code={code} note={t('Shown once. Works once, for one hour.')}
        share={t('Your openGym reset code: {0}. Open {1}, tap Sign in, then “Forgot password?”.', fmtCode(code), location.origin)} />),
      () => toast(t('Could not make a reset code.')))
  })

  return <>
    <Section title={t('Members & invites')} footer={t('Only you see this card. Codes are shown once; only a fingerprint of each is stored.')}>
      <Row icon="sparkles" iconTint="var(--acc)" title={t('Create invite code')} accessory="chevron" onClick={newInvite} />
      {invites.map(i => <Row key={i.id} icon="key" iconTint={i.status === 'open' ? 'var(--green)' : 'var(--grey)'}
        title={i.note || i.email || t('Invite')}
        subtitle={[t(STATUS[i.status] || i.status), i.status === 'used' ? i.used_by_email : i.status === 'open' ? t('until {0}', day(i.expires_at)) : day(i.created_at)].filter(Boolean).join(' · ')}
        accessory={i.status === 'open' ? 'chevron' : 'none'} onClick={i.status === 'open' ? () => revoke(i) : undefined} />)}
    </Section>
    <Section title={t('Members')} footer={t('Tap a member to make a password reset code. You never see their data.')}>
      {members.map(m => <Row key={m.user_id} icon="personCircle" iconTint="var(--blue)" title={m.email} accessory="chevron" onClick={() => resetFor(m)} />)}
    </Section>
  </>
}

function InviteSheet({ close, onMade }) {
  const [note, setNote] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState(null)
  const [busy, setBusy] = useState(false)
  const make = async () => {
    const m = email.trim().toLowerCase()
    if (m && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) { toast(t('Enter a valid email address.')); return }
    setBusy(true)
    try { setCode(await accountRpc('gym_invite_mint', { note: note.trim() || null, email: m || null })); onMade() }
    catch (e) { toast(t('Could not create the invite.')) }
    setBusy(false)
  }
  if (code) return <CodeSheet code={code} note={t('Shown once. Expires in 7 days.')}
    share={t('Your openGym invite: {0}. Open {1} and tap “I have an invite code”.', fmtCode(code), location.origin)} />
  return <>
    <h3>{t('Create invite code')}</h3>
    <input className="input" maxLength={80} placeholder={t('Who is it for? (only you see this)')} value={note} onChange={e => setNote(e.target.value)} />
    <div style={{ height: 10 }} />
    <input className="input" type="email" inputMode="email" autoCapitalize="none" placeholder={t('Their email (optional)')} value={email} onChange={e => setEmail(e.target.value)} />
    <div className="dim small" style={{ marginTop: 6 }}>{t('With an email, only that address can use the code.')}</div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={make} disabled={busy}>{busy ? t('Creating…') : t('Create code')}</Button>
    <div style={{ height: 6 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

function CodeSheet({ code, note, share }) {
  const c = fmtCode(code)
  const copy = () => navigator.clipboard?.writeText(c).then(() => toast(t('Copied')), () => toast(c))
  return <div style={{ textAlign: 'center' }}>
    <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: '.08em', margin: '8px 0 14px', userSelect: 'all', overflowWrap: 'anywhere' }}>{c}</div>
    <Button variant="primary" icon="clipboard" onClick={copy}>{t('Copy')}</Button>
    {navigator.share && <><div style={{ height: 8 }} />
      <Button icon="upload" onClick={() => navigator.share({ text: share }).catch(() => {})}>{t('Share')}</Button></>}
    <div className="dim small" style={{ marginTop: 12 }}>{note}</div>
  </div>
}

// Two steps: this sheet, then typing DELETE. Export is offered inside, before it is too late.
export function deleteAccountSheet({ exportFirst, onDeleted }) {
  useUI.getState().openSheet(close => <DeleteAccount close={close} exportFirst={exportFirst} onDeleted={onDeleted} />)
}
function DeleteAccount({ close, exportFirst, onDeleted }) {
  const [word, setWord] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try { await useStore.getState().deleteAccount(); close(); onDeleted() }
    catch (e) { setBusy(false); toast(e.status === 0 ? t('You’re offline. Connect and try again — your data is safe on this phone.') : t('Could not delete the account. Nothing was removed.')) }
  }
  return <>
    <h3>{t('Delete your account?')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {t('Your workouts, plans and profile are removed from openGym for good. Export a backup first if you want to keep them.')}
    </div>
    <Button icon="download" onClick={exportFirst}>{t('Export backup (JSON)')}</Button>
    <div style={{ height: 12 }} />
    <input className="input" autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder={t('Type DELETE to confirm')}
      value={word} onChange={e => setWord(e.target.value)} />
    <div style={{ height: 12 }} />
    <button className="btn danger" onClick={go} disabled={busy || word.trim() !== 'DELETE'}>{busy ? t('Deleting…') : t('Delete account')}</button>
    <div style={{ height: 6 }} />
    <Button variant="ghost" className="dim" onClick={close} disabled={busy}>{t('Cancel')}</Button>
  </>
}
