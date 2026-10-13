import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, api, BIO } from '../lib/api.js'
import { SUPABASE, sendCode, verifyCode } from '../lib/supabaseSync.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { useState, useRef, useEffect } from 'react'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

function RegisterSheet({ close }) {
  const { setUser, pushState, pullState } = useStore()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [inviteOnly, setInviteOnly] = useState(false)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  useEffect(() => { api('/api/config').then(c => setInviteOnly(!!c.invite_only)).catch(() => {}) }, [])
  const go = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { useUI.getState().toast(t('An invite code is required')); return }
    try {
      const u = await passkeyRegister(n, code.trim())
      setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created — data from this device moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Registration failed')) }
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with {0}. The passkey is saved in your device — no password needed.', BIO)}</div>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
    </>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}

// Supabase build: email one-time code, both steps in one sheet. Errors go to a toast and the
// sheet keeps its inputs (a wrong code clears the code field).
export function EmailSignInSheet({ close }) {
  const { setUser, pullState } = useStore()
  const [step, setStep] = useState('email')
  const [email, setEmail] = useState(() => localStorage.getItem('gym_email') || '')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [step])
  const toast = m => useUI.getState().toast(m)
  const fail = e => {
    if (e.status === 0 || !navigator.onLine) toast(t('You’re offline. Connect and try again — your data is safe on this phone.'))
    else if (e.status === 429 || e.code === 'over_email_send_rate_limit') toast(t('Too many codes requested. Wait a few minutes — your last code still works.'))
    // The owner-only trigger on auth.users surfaces as a 500 "Database error saving new user".
    else if (['otp_disabled', 'signup_disabled'].includes(e.code) || (e.status >= 500 && /database error/i.test(e.message))) toast(t('This email can’t sign in to this app.'))
    else toast(t('Sign-in failed'))
  }
  const send = async () => {
    const m = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) { toast(t('Enter a valid email address.')); return }
    setBusy(true)
    try { await sendCode(m); localStorage.setItem('gym_email', m); setEmail(m); setStep('code') }
    catch (e) { fail(e) }
    setBusy(false)
  }
  const verify = async () => {
    setBusy(true)
    try {
      const u = await verifyCode(email, code)
      setUser(u); close()
      toast(t('Signed in — syncing your workouts.'))
      await pullState()
    } catch (e) {
      setBusy(false)
      if (e.status >= 400 && e.status < 500 && e.status !== 429) { setCode(''); toast(t('That code is wrong or expired. Try again or resend.')) }
      else fail(e)
    }
  }
  const lbl = { marginBottom: 14 }
  if (step === 'email') return <>
    <h3>{t('Sign in')}</h3>
    <div className="muted small" style={lbl}>{t('We’ll email you a one-time code.')}</div>
    <input ref={ref} className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
      placeholder={t('Email address')} value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} />
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={send} disabled={busy}>{busy ? t('Sending…') : t('Send code')}</Button>
  </>
  return <>
    <h3>{t('Enter code')}</h3>
    <div className="muted small" style={lbl}>{t('We sent a code to {0}. It may take a minute — check spam too.', email)}</div>
    <input ref={ref} className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={10} placeholder="123456"
      value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={e => e.key === 'Enter' && code.length >= 6 && verify()}
      style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={verify} disabled={busy || code.length < 6}>{busy ? t('Checking…') : t('Verify')}</Button>
    <div style={{ height: 6 }} />
    <Button variant="ghost" size="sm" onClick={send} disabled={busy}>{t('Resend code')}</Button>
    <Button variant="ghost" size="sm" onClick={() => { setCode(''); setStep('email') }}>{t('Use a different email')}</Button>
  </>
}

export default function Login() {
  const { setUser, pullState, setGuest } = useStore()
  const signIn = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); useUI.getState().toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Sign-in failed')) }
  }
  const head = <>
    <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="dumbbell" /></div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>openGym</h1>
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo — everything stays in this browser.')}</div>
      <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'left', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data — nothing is sent anywhere. Passkey sign-in and sync across your devices come with the openGym server, which you get by self-hosting it.')}
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 34 }}>{t('Your workouts. Your weights. Your profile.')}</div>
      {SUPABASE ? <>
        <Button variant="primary" icon="person" onClick={() => useUI.getState().openSheet(close => <EmailSignInSheet close={close} />)}>{t('Sign in with email')}</Button>
        <div style={{ height: 10 }} />
      </> : webauthnOK() ? <>
        <Button variant="primary" icon="person" onClick={signIn}>{t('Sign in with passkey')}</Button>
        <div style={{ height: 10 }} />
        <Button icon="sparkles" onClick={() => useUI.getState().openSheet(close => <RegisterSheet close={close} />)}>{t('Create new profile')}</Button>
        <div style={{ height: 10 }} />
      </> : <div className="card small muted" style={{ textAlign: 'left' }}>{t("This browser doesn't support passkeys — you can still use openGym locally on this device.")}</div>}
      <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>
      {SUPABASE
        ? <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{t('Only the owner’s email can sign in.')}<br />{t('Without an account, data stays on this phone.')}</div>
        : <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{t('Passkeys use {0} — no passwords.', BIO)}<br />{t('Each profile keeps its own plan, workouts & body weight.')}</div>}
    </div>
  )
}
