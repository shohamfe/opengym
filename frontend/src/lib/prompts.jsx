// Launch nudges: "add to Home Screen" in the browser, "turn on notifications" in the installed app.
import { toast } from 'sonner'
import { t, getLang } from './i18n.js'
import { IS_ANDROID } from './api.js'
import { IOS, standalone, pushSupported, enablePush } from './push.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'

const SNOOZE_DAYS = 14
const snoozed = k => { try { return Date.now() - (+localStorage.getItem('gym_snooze_' + k) || 0) < SNOOZE_DAYS * 864e5 } catch { return false } }
const snooze = k => { try { localStorage.setItem('gym_snooze_' + k, Date.now()) } catch {} }

// Chrome (Android/desktop) fires this once, early; keeping it lets our button open the real install dialog.
// iPhone never fires it: there the banner can only explain the Share → Add to Home Screen steps.
let deferred = null
let armed = false
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; if (armed) installBanner() })
addEventListener('appinstalled', () => toast.dismiss('install'))

// Step-by-step guide for browsers with no install dialog (iPhone, Firefox…): pwa-add-to-homescreen picks the
// steps for the exact browser/iOS version; its look is restyled in index.css (.adhs-*). Loaded only when opened.
async function installGuide() {
  const [{ version }] = await Promise.all([import('pwa-add-to-homescreen/package.json'), import('pwa-add-to-homescreen'), import('pwa-add-to-homescreen/dist/add-to-homescreen.min.css')])
  window.AddToHomeScreen({
    appName: 'openGym', appIconUrl: 'icon-180.png', showArrow: true,
    assetUrl: `https://cdn.jsdelivr.net/npm/pwa-add-to-homescreen@${version}/dist/assets/img/`   // 5.8 MB of step images, so not bundled
  }).show(getLang())
}

function installBanner() {
  if (standalone() || snoozed('install') || !(IOS || IS_ANDROID || deferred)) return
  const close = () => { toast.dismiss('install'); snooze('install') }
  const install = () => { if (deferred) deferred.prompt(); else installGuide(); deferred = null; close() }
  toast.custom(() => <div className="ib">
    <img src="icon-180.png" alt="" />
    <div className="ib-mid">
      <div className="ib-t">{t('Install openGym')}</div>
      <div className="ib-s">{t('Get workout notifications')}</div>
    </div>
    {/* iPhone has no install API: its button opens the guide to Safari's own Share → Add to Home Screen */}
    <button className="ib-btn" onClick={install}>{deferred ? t('Install') : t('Show me')}</button>
    <button className="ib-x" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
  </div>, { id: 'install', duration: Infinity, onDismiss: () => snooze('install') })
}

function pushPrompt(user) {
  if (!user || !standalone() || !pushSupported() || Notification.permission !== 'default' || snoozed('push')) return
  snooze('push')   // asked once per SNOOZE_DAYS whatever the answer; a yes changes the permission anyway
  // the browser only shows its permission dialog from a tap, hence a screen with a button first
  confirmSheet({
    title: t('Turn on notifications?'),
    message: t('Get told when your rest is over and on workout days, even when openGym is closed.'),
    confirmText: t('Turn on notifications'), cancelText: t('Not now'),
    onConfirm: () => enablePush().then(() => toast(t('Notifications on')), () => toast(t('Could not change notification settings')))
  })
}

export function launchPrompts(user) {
  armed = true
  const tm = setTimeout(() => { installBanner(); pushPrompt(user) }, 1500)
  return () => { clearTimeout(tm); armed = false }
}
