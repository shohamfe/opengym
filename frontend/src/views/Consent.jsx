// The Supabase OAuth 2.1 server sends an AI app's "Connect" here (/oauth/consent?authorization_id=…,
// a real path, so vercel.json rewrites it to the app). It stands outside the router and the normal
// shell: sign in if needed, then show who is asking and Allow / Deny.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { oauthDetails, oauthDecide, signedInEmail } from '../lib/supabaseSync.js'
import { t } from '../lib/i18n.js'
import { EmailSignInSheet } from './Login.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

const hostOf = u => { try { return new URL(u).host } catch { return '' } }

export default function Consent() {
  const { user, ready, signOut } = useStore()
  const id = new URLSearchParams(location.search).get('authorization_id')
  const [d, setD] = useState(null)        // details, 'error', or null while loading
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user || !id) return
    setD(null)
    oauthDetails(id).then(r => {
      // Already consented earlier: Supabase answers with where to go straight away.
      if (!r?.authorization_id && r?.redirect_url) location.replace(r.redirect_url)
      else setD(r)
    }, () => setD('error'))
  }, [user, id])

  const decide = async approve => {
    setBusy(true)
    try { const r = await oauthDecide(id, approve); location.replace(r.redirect_url) }
    catch { setBusy(false); setD('error') }
  }

  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '86vh', textAlign: 'center' }
  const head = <div style={{ fontSize: 48, display: 'flex', justifyContent: 'center', color: 'var(--acc)', marginBottom: 8 }}><Icon name="dumbbell" /></div>

  let body
  if (!id || d === 'error') body = <>
    <h1 style={{ fontSize: 24 }}>{t('This sign-in link expired')}</h1>
    <div className="muted" style={{ marginTop: 8 }}>{t('Go back to your AI app and try connecting again.')}</div>
  </>
  else if (!ready && !user) body = null
  else if (!user) body = <>
    <h1 style={{ fontSize: 24 }}>{t('Connect an AI app')}</h1>
    <div className="muted" style={{ margin: '8px 0 22px' }}>{t('Sign in to your openGym account first.')}</div>
    <Button variant="primary" icon="person" onClick={() => useUI.getState().openSheet(close => <EmailSignInSheet close={close} />)}>{t('Sign in with email')}</Button>
  </>
  else if (!d) body = <div className="muted">{t('Loading…')}</div>
  else body = <>
    <h1 style={{ fontSize: 24 }}>{t('{0} wants to use your openGym account', d.client?.name || t('An AI app'))}</h1>
    <div className="card" style={{ textAlign: 'left', margin: '18px 0' }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('It will be able to:')}</div>
      <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
        <li>{t('see your profile (including pregnancy info), routines and workouts')}</li>
        <li>{t('create, change and delete routines')}</li>
      </ul>
      <div className="muted small" style={{ marginTop: 8 }}>{t('It can’t change your password or delete your account.')}</div>
    </div>
    <div className="dim small" style={{ marginBottom: 16 }}>
      {t('Signed in as {0}', d.user?.email || signedInEmail() || user.name)}
      {hostOf(d.redirect_uri) && <><br />{t('Returns you to {0}', hostOf(d.redirect_uri))}</>}
    </div>
    <Button variant="primary" onClick={() => decide(true)} disabled={busy}>{t('Allow')}</Button>
    <div style={{ height: 10 }} />
    <Button onClick={() => decide(false)} disabled={busy}>{t('Deny')}</Button>
    <div style={{ height: 6 }} />
    <Button variant="ghost" size="sm" disabled={busy} onClick={() => signOut().catch(() => useUI.getState().toast(t('Couldn’t sync, so you’re still signed in. Nothing was deleted.')))}>{t('Not you? Sign out')}</Button>
  </>

  return <div id="app"><div className="narrow" style={wrap}>{head}{body}</div></div>
}
