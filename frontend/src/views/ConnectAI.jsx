// #/connect-ai: the MCP connector's link, setup steps for Claude and ChatGPT, and the AI apps
// this account has allowed (Supabase OAuth grants) with Disconnect.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { SUPABASE, MCP_URL, oauthGrants, oauthRevoke } from '../lib/supabaseSync.js'
import { t } from '../lib/i18n.js'
import { back } from '../lib/nav.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Section, Row, Button } from '../components/ui.jsx'

const Steps = ({ items }) => <div className="card"><ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>{items.map(s => <li key={s} style={{ marginBottom: 4 }}>{s}</li>)}</ol></div>

function Grants() {
  const toast = useUI(s => s.toast)
  const [list, setList] = useState(null)       // null loading, 'error', or the grants
  const load = () => oauthGrants().then(g => setList(Array.isArray(g) ? g : []), () => setList('error'))
  useEffect(() => { load() }, [])
  const revoke = g => confirmSheet({
    title: t('Disconnect {0}?', g.client?.name || t('An AI app')), message: t('It loses access to your openGym account right away. You can connect it again later.'),
    confirmText: t('Disconnect'), danger: true,
    onConfirm: () => oauthRevoke(g.client.id).then(load, () => toast(t('Couldn’t disconnect. Check your connection and try again.')))
  })
  return <Section title={t('Connected AI apps')}>
    {list === null ? <Row title={t('Loading…')} />
      : list === 'error' ? <Row icon="lock" iconTint="var(--grey)" title={t('Couldn’t load connected apps.')} />
      : !list.length ? <Row icon="sparkles" iconTint="var(--grey)" title={t('No AI apps connected.')} />
      : list.map(g => <Row key={g.client?.id} icon="sparkles" iconTint="var(--indigo)" title={g.client?.name || g.client?.id}
          subtitle={g.granted_at ? t('Connected {0}', new Date(g.granted_at).toLocaleDateString()) : null}>
          <Button size="sm" variant="tinted" onClick={() => revoke(g)}>{t('Disconnect')}</Button>
        </Row>)}
  </Section>
}

export default function ConnectAI() {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const copy = () => navigator.clipboard?.writeText(MCP_URL).then(() => toast(t('Link copied')), () => toast(MCP_URL))
  const ready = SUPABASE && user
  return <div className="narrow">
    <div className="hdr wv-hdr" style={{ marginBottom: 6 }}><button className="iconbtn" onClick={() => back('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <h1 style={{ flex: 1 }}>{t('Connect your AI')}</h1></div>
    <div className="hdr-sub">{t('Let Claude or ChatGPT read your plan and build routines for you.')}</div>

    {!ready ? <Section><Row icon="lock" iconTint="var(--grey)" title={t('Sign in with email to connect an AI app.')} /></Section> : <>
      <Section title={t('Your connector link')} footer={t('Works with the free Claude plan. ChatGPT needs a paid plan and only works on chatgpt.com on a computer. Any other AI: use Copy prompt.')}>
        {/* the link gets the full row width (it wrapped 4 lines beside the button at 320px) */}
        <Row icon="link" iconTint="var(--acc)" title={<span style={{ wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{MCP_URL}</span>} />
        <Row icon="clipboard" iconTint="var(--blue)" title={<span className="accent">{t('Copy link')}</span>} onClick={copy} />
      </Section>

      <Section title={t('Claude (free plan works)')} footer={t('The free plan allows one custom connector. If yours is taken, remove the other one first.')}>
        <Steps items={[
          t('Tap Copy link above.'),
          t('Open claude.ai in a browser and sign in. On iPhone use Safari: connectors can’t be added in the Claude app.'),
          t('Go to Settings → Connectors → Add custom connector.'),
          t('Name: openGym. URL: paste the link. Tap Add.'),
          t('Tap Connect. The openGym page opens: sign in and tap Allow.'),
          t('In a chat, check that openGym is on under + → Connectors, then ask, for example: “Build me a 3-day routine.” It also works in the Claude phone app.')
        ]} />
      </Section>

      <Section title={t('ChatGPT (paid plan, experimental)')} footer={t('Experimental: if ChatGPT stops reaching openGym after a while, connect again or use Copy prompt.')}>
        <Steps items={[
          t('Tap Copy link above.'),
          t('On a computer, open chatgpt.com → Settings → Apps → Advanced settings and turn on Developer mode.'),
          t('In Apps, choose Create app. Name: openGym. MCP server URL: paste the link. Authentication: OAuth. Tick “I trust this application”, then Create.'),
          t('Tap Connect. The openGym page opens: sign in and tap Allow.'),
          t('In a chat, choose + → Developer mode → openGym, then ask.')
        ]} />
      </Section>

      <Grants />
    </>}
  </div>
}
