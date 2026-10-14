import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, api, BIO } from '../lib/api.js'
import { SUPABASE, signIn as pwSignIn, setupPassword } from '../lib/supabaseSync.js'
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

// Supabase build: email + password. The first time, a one-time setup code from Claude sets the
// password. Errors go to a toast and the sheet keeps its inputs.
export function EmailSignInSheet({ close }) {
  const { setUser, pullState } = useStore()
  const [email, setEmail] = useState(() => localStorage.getItem('gym_email') || '')
  const [pw, setPw] = useState('')
  const [code, setCode] = useState(null)   // null = normal sign-in, string = setting the password
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  const toast = m => useUI.getState().toast(m)
  const go = async () => {
    const m = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) { toast(t('Enter a valid email address.')); return }
    if (code !== null && !code.trim()) { toast(t('Enter the setup code.')); return }
    if (pw.length < (code !== null ? 10 : 1)) { toast(code !== null ? t('Use at least 10 characters.') : t('Enter your password.')); return }
    setBusy(true)
    try {
      const u = code !== null ? await setupPassword(m, code, pw) : await pwSignIn(m, pw)
      localStorage.setItem('gym_email', m)
      setUser(u); close()
      toast(t('Signed in — syncing your workouts.'))
      await pullState()
    } catch (e) {
      setBusy(false)
      if (e.status === 0 || !navigator.onLine) toast(t('You’re offline. Connect and try again — your data is safe on this phone.'))
      else if (e.status === 429) toast(t('Too many tries. Wait a few minutes and try again.'))
      else if (code !== null && e.status >= 400 && e.status < 500) toast(t('That setup code is wrong, expired or already used.'))
      else if (e.status >= 400 && e.status < 500) toast(t('Wrong email or password.'))
      else toast(t('Sign-in failed'))
    }
  }
  const enter = e => e.key === 'Enter' && go()
  return <>
    <h3>{code !== null ? t('Set your password') : t('Sign in')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {code !== null ? t('Enter the setup code Claude gave you, then choose a password.') : t('Only the owner’s email can sign in.')}
    </div>
    <input ref={ref} className="input" type="email" inputMode="email" autoComplete="username" autoCapitalize="none"
      placeholder={t('Email address')} value={email} onChange={e => setEmail(e.target.value)} onKeyDown={enter} />
    {code !== null && <><div style={{ height: 10 }} />
      <input className="input" autoComplete="one-time-code" autoCapitalize="characters" placeholder={t('Setup code')}
        value={code} onChange={e => setCode(e.target.value.toUpperCase())} onKeyDown={enter} /></>}
    <div style={{ height: 10 }} />
    <input className="input" type="password" autoComplete={code !== null ? 'new-password' : 'current-password'}
      placeholder={code !== null ? t('New password') : t('Password')} value={pw} onChange={e => setPw(e.target.value)} onKeyDown={enter} />
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go} disabled={busy}>{busy ? t('Checking…') : code !== null ? t('Set password and sign in') : t('Sign in')}</Button>
    <div style={{ height: 6 }} />
    <Button variant="ghost" size="sm" onClick={() => setCode(code !== null ? null : '')} disabled={busy}>
      {code !== null ? t('I already have a password') : t('First time? I have a setup code')}
    </Button>
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
