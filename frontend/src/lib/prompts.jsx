// Launch nudges: "add to Home Screen" in the browser, "turn on notifications" in the installed app.
import { toast } from 'sonner'
import { t } from './i18n.js'
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

// the Share glyph goes where the translation puts {0}
const shareSteps = () => { const [a, b] = t('Tap {0} then Add to Home Screen').split('{0}'); return <>{a}<span className="ib-share"><Icon name="upload" /></span>{b}</> }

function installBanner() {
  if (standalone() || snoozed('install') || !(IOS || IS_ANDROID || deferred)) return
  const close = () => { toast.dismiss('install'); snooze('install') }
  const install = () => { deferred.prompt(); deferred = null; close() }
  toast.custom(() => <div className="ib">
    <img src="icon-180.png" alt="" />
    <div className="ib-mid">
      <div className="ib-t">{t('Install openGym')}</div>
      {/* iPhone: no API opens Add to Home Screen, Safari's own Share button is the only way */}
      <div className="ib-s">{deferred ? t('Get workout notifications')
        : IOS ? shareSteps()
        : t('In Chrome: ⋮ menu → Add to Home screen')}</div>
    </div>
    {deferred && <button className="ib-btn" onClick={install}>{t('Install')}</button>}
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
