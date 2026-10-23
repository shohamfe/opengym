import { create } from 'zustand'
import { api } from '../lib/api.js'
import { localTZ } from '../lib/format.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { MOBILE, nativeLoad, nativeSave, syncReminder } from '../lib/mobile.js'
import { BASE, OWNER, accountRpc } from '../lib/supabaseSync.js'
import { disablePush } from '../lib/push.js'
import { migrateSide } from '../lib/history.js'

const KEY = 'gym_state_v1'
export const DEF = {
  unit: 'kg', restSec: 90, sound: true, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'lime', body: 'male', targetW: null, weekStart: 1,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full', seenTechHint: false,
  // null = not onboarded; shape in lib/profile.js (build-plan contract)
  profile: null,
  // effort: which per-set effort scale is logged — 'none' | 'rir' | 'rpe'. null, not 'none', so
  // that a profile which never chose (loaded state is overlaid on DEF, on every path: local,
  // server pull, backup import) still falls back to the `showRir` boolean this replaced and
  // keeps the column it had. See effortOf.
  reminder: { on: false, time: '08:00', tz: null }, effort: null,
  // Push alert types besides the day reminder (S.reminder); the server reads these too, and
  // reminder.tz is the timezone for all of them.
  notify: { rest: true, stale: true, staleMin: 90, streak: false, weigh: false, weighDay: 1, weighTime: '08:00' },
  // The person (lib/profile.js); null = not onboarded yet. bodyPick: the diagram override, null = Auto.
  profile: null, bodyPick: null
}
const clone = o => JSON.parse(JSON.stringify(o))

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const S = Object.assign(clone(DEF), JSON.parse(raw))
      // A one-time data fix changes the plan, so it has to reach the server like an edit would.
      if (migrateSide(S)) { S._ts = Date.now(); localStorage.setItem(KEY, JSON.stringify(S)); localStorage.setItem('gym_dirty', '1') }
      return S
    }
  } catch (e) { /* ignore */ }
  return clone(DEF)
}

const hasData = st => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length)

// Adds to `server` (in place) the logged workouts (by id) and weigh-ins (by day) that only `local`
// has; everything else — routines, plan, settings — stays as the server has it. Returns how many
// entries were added.
function mergeLogs(server, local) {
  const ids = new Set((server.workouts || []).map(w => w.id))
  const days = new Set((server.bodyweight || []).map(b => b.d))
  const w = (local.workouts || []).filter(x => !ids.has(x.id))
  const b = (local.bodyweight || []).filter(x => !days.has(x.d))
  if (w.length) server.workouts = [...(server.workouts || []), ...w].sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : (x.start || 0) - (y.start || 0)))
  if (b.length) server.bodyweight = [...(server.bodyweight || []), ...b].sort((x, y) => (x.d < y.d ? -1 : 1))
  return w.length + b.length
}

export const useStore = create((set, get) => {
  let pushTm = null
  let saveTm = null

  // Mobile build: mirror the state into a file in the app's data directory (survives WebView
  // storage eviction) and keep the native reminder schedule in step with the weekly plan.
  const nativePersist = () => {
    clearTimeout(saveTm)
    saveTm = setTimeout(() => { saveTm = null; nativeSave(get().S); syncReminder(get().S) }, 800)
  }

  // keepTs: a copy taken from the server keeps the server's _ts, so it does not look newer than
  // the server and get uploaded straight back.
  const persist = (S, push = true, keepTs = false) => {
    if (!keepTs) S._ts = Date.now()
    registerCustom(S.customEx)
    localStorage.setItem(KEY, JSON.stringify(S))
    set({ S })
    if (MOBILE) nativePersist()
    if (push && get().user) {
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce
  // (e.g. setting the reminder time then immediately backgrounding to test it). On mobile the
  // same applies to the file mirror — backgrounding is often the last thing before the OS
  // kills the app.
  // Coming back to the app: pick up edits made elsewhere (another device, or Claude on the server).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { if (get().user && get().ready) get().pullState(); return }
    if (document.visibilityState !== 'hidden') return
    if (MOBILE && saveTm) {
      clearTimeout(saveTm)
      saveTm = null
      nativeSave(get().S)
    }
    if (pushTm) {
      clearTimeout(pushTm)
      pushTm = null
      get().pushState()
    }
  })

  // Everything on this device that belongs to the signed-in account, backups included.
  const dropLocal = () => {
    clearTimeout(pushTm)
    for (const k of [KEY, BASE, OWNER, 'gym_dirty', 'gym_backup_v1', 'gym_unit_backup']) localStorage.removeItem(k)
    persist(clone(DEF), false, true)   // no _ts: an empty copy is never "newer" than the server's
    set({ synced: false })   // the empty copy says nothing about the account's profile until the next pull
  }

  // Everything a sign-out leaves behind on this device, whichever way it was triggered.
  const clearLocalSession = () => {
    get().setUser(null)
    localStorage.removeItem('gym_guest')
    dropLocal()
  }

  return {
    S: (() => { const s = loadState(); registerCustom(s.customEx); return s })(),
    user: (() => { try { return JSON.parse(localStorage.getItem('gym_user')) || null } catch { return null } })(),
    ready: false,
    synced: false,   // the server copy has been read at least once since sign-in (onboarding gate)

    // Mutate a draft of S via producer fn, then persist + schedule sync.
    update(mut, push = true) {
      const S = clone(get().S)
      mut(S)
      persist(S, push)
    },
    replaceState(S, push = false) { persist(clone(S), push) },

    isGuest: () => localStorage.getItem('gym_guest') === '1',
    setGuest(v) { if (v) localStorage.setItem('gym_guest', '1'); else localStorage.removeItem('gym_guest'); set({}) },

    setUser(u) {
      if (u) {
        // Shared phone: the local data belongs to another account whose session died (401 keeps
        // it). Never push or merge it into this one: wipe it, and stop its alerts on this device.
        // Untagged data is claimed: shortcut: before this build only the owner could sign in, so
        // untagged synced data is the owner's or a true guest's; fine as long as this build
        // reaches every device before a second account exists.
        const owner = localStorage.getItem(OWNER)
        if (owner && owner !== String(u.id)) { dropLocal(); disablePush().catch(() => {}) }
        localStorage.setItem(OWNER, u.id)
        localStorage.setItem('gym_user', JSON.stringify(u)); localStorage.removeItem('gym_guest')
      }
      else localStorage.removeItem('gym_user')
      set(u ? { user: u } : { user: u, synced: false })
    },

    async pushState() {
      if (!get().user) return
      clearTimeout(pushTm)
      try { await api('/api/data', { method: 'PUT', body: JSON.stringify({ state: get().S }) }); localStorage.removeItem('gym_dirty') }
      catch (e) {
        localStorage.setItem('gym_dirty', '1')
        // Session gone (revoked, expired refresh token): show the sign-in screen, keep the data.
        if (e.status === 401) get().setUser(null)
        // 409: the server copy changed since this device last synced (e.g. edited by Claude).
        // Take it, keeping this device's logged workouts and weigh-ins (see pullState).
        if (e.status === 409) return get().pullState(true)
      }
    },
    // force: take the server copy even if this device looks newer (after a 409).
    async pullState(force = false) {
      try {
        const { state } = await api('/api/data')
        set({ synced: true })
        const S = get().S
        const dirty = localStorage.getItem('gym_dirty') === '1'
        // First sync of this device (fresh sign-in, guest data): merge rather than pick a side.
        const merge = force || !localStorage.getItem(BASE)
        if (state && state._ts === S._ts && !dirty) return   // already have exactly this copy
        if (state && (merge || !hasData(S) || ((state._ts || 0) >= (S._ts || 0) && !dirty))) {
          localStorage.setItem(BASE, state._ts || '')
          const next = Object.assign(clone(DEF), state)
          let added = 0
          if (merge && hasData(S)) {
            // One-slot safety copy of what this device had, before the server copy replaces it.
            localStorage.setItem('gym_backup_v1', JSON.stringify(S))
            added = mergeLogs(next, S)
          }
          if (S.active) next.active = S.active
          const fixed = migrateSide(next) > 0
          persist(next, fixed, !fixed)
          localStorage.removeItem('gym_dirty')
          if (added) await get().pushState()
        } else if (hasData(S)) { await get().pushState() }
      } catch (e) { if (e.status === 401) get().setUser(null) /* else offline — keep local */ }
    },

    // Throws, and keeps everything, when the final push failed: wiping now would lose those changes.
    async signOut() {
      await get().pushState()   // never throws — stores gym_dirty and moves on when offline
      if (!get().user) return     // the push found the session already gone: signed out, data kept
      if (localStorage.getItem('gym_dirty') === '1') throw new Error('sync failed')
      await disablePush().catch(() => {})   // or the next profile on this device gets this one's alerts
      try { await api('/api/logout', { method: 'POST', body: '{}' }) } catch (e) { /* */ }
      clearLocalSession()
    },

    // "Sign out everywhere": the server bumps this profile's session version, which kills every
    // session it has on any device — this browser included, so the app has to end up exactly
    // where a normal signOut leaves it. Unlike signOut the request is NOT swallowed: if it fails
    // the sessions elsewhere are all still valid, and wiping this device's copy of the data
    // would sign the user out of the one place the bump didn't reach. Caller reports the error.
    async signOutAll() {
      await get().pushState()   // never throws — stores gym_dirty and moves on when offline
      await disablePush().catch(() => {})
      await api('/api/logout/all', { method: 'POST', body: '{}' })
      clearLocalSession()
    },

    // Settings → Delete account (Supabase build). The server removes the account and all its rows
    // (gym_delete_me); this device then ends up where a sign-out leaves it. Throws, and keeps
    // everything, when the server call fails.
    async deleteAccount() {
      await accountRpc('gym_delete_me')
      await disablePush().catch(() => {})
      await api('/api/logout', { method: 'POST', body: '{}' }).catch(() => {})
      clearLocalSession()
    },

    // Demo build only: drop the seeded example profile back in (Settings → "Reset demo data").
    // Dynamic import so the generator never ships in a self-hosted bundle.
    async resetDemo() {
      const { buildDemoState } = await import('../lib/demoSeed.js')
      localStorage.removeItem('gym_dirty')
      persist(Object.assign(clone(DEF), buildDemoState()), false)
    },

    // Boot: ask the server who we are, then pull.
    async boot() {
      // Mobile build: no backend either — restore from the file mirror (the durable copy;
      // localStorage may have been evicted since the last run) and go straight in.
      if (MOBILE) {
        const saved = await nativeLoad()
        const S = get().S
        if (saved && (!hasData(S) || (saved._ts || 0) >= (S._ts || 0))) {
          persist(Object.assign(clone(DEF), saved), false)
        } else if (hasData(S)) {
          nativeSave(S)   // first run after an update from a file-less version: seed the mirror
        }
        get().setGuest(true)
        syncReminder(get().S)
        set({ ready: true })
        return
      }
      // Demo build (GitHub Pages): no backend at all — seed once, stay in guest mode.
      if (DEMO) {
        if (!localStorage.getItem(DEMO_SEEDED)) {
          localStorage.setItem(DEMO_SEEDED, '1')
          await get().resetDemo()
        }
        get().setGuest(true)
        set({ ready: true })
        return
      }
      try {
        const me = await api('/api/me')
        get().setUser(me.user)
        await get().pullState()
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const tz = localTZ()
        const N = get().S.notify || {}
        if ((get().S.reminder?.on || N.streak || N.weigh) && get().S.reminder?.tz !== tz) {
          get().update(s => { s.reminder = { ...(s.reminder || DEF.reminder), tz } })
        }
      } catch (e) {
        if (e.status === 401) get().setUser(null)
      }
      set({ ready: true })
    }
  }
})

export { hasData, mergeLogs }
