import { t } from './i18n.js'

// Invite and reset codes: 12 Crockford base32 characters, shown as XXXX-XXXX-XXXX. The server
// normalises the same way before hashing (gym_code_hash), so pasted spaces, hyphens, lower case
// and I/L/O typos still match.
export const normCode = s => (s || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0').slice(0, 12)
export const fmtCode = s => normCode(s).match(/.{1,4}/g)?.join('-') || ''

// One message per failure for the sign-in, join and reset sheets. Any code problem (wrong, used,
// expired, revoked, other email) is one message on purpose: the gate's refusal reaches the
// client as a bare 500 "Database error saving new user".
export function authError(e, kind) {
  if (e.status === 0 || globalThis.navigator?.onLine === false) return t('You’re offline. Connect and try again — your data is safe on this phone.')
  if (e.status === 429) return t('Too many tries. Wait a few minutes and try again.')
  const client = e.status >= 400 && e.status < 500
  if (kind === 'join') {
    if (e.code === 'weak_password') return t('Use at least 10 characters.')
    if (e.status === 422 || e.code === 'user_already_exists' || e.code === 'email_exists') return t('This email already has an account. Sign in instead.')
    return t('That code is wrong, expired or already used.')
  }
  if (kind === 'reset') return client ? t('That code is wrong, expired or already used.') : t('Sign-in failed')
  return client ? t('Wrong email or password.') : t('Sign-in failed')
}
