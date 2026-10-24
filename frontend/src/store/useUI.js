import { create } from 'zustand'
import { toast as sonner } from 'sonner'
import { uid } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { useStore, DEF } from './useStore.js'

// Fire-and-forget: lets the server push a "rest over" alert if this tab gets suspended
// before the local timer completes. No-ops for guests / offline / that alert switched off.
const notifyOn = k => { const st = useStore.getState(); return st.user && { ...DEF.notify, ...st.S.notify }[k] }
// One chain for all push calls: parallel requests can land out of order (a cancel after the new schedule).
let pushQ = Promise.resolve()
const post = (path, body) => (pushQ = pushQ.then(() => api(path, { method: 'POST', body: JSON.stringify(body || {}) }).catch(() => {})))
const pushRestTimer = sec => { if (notifyOn('rest')) post('/api/push/rest-timer', { seconds: sec, title: t('Rest over') + ' 💪', body: t('Time for your next set.') }) }
const cancelPushRestTimer = () => { if (useStore.getState().user) return post('/api/push/rest-timer/cancel') }

// "Still training?" if the open workout gets no new set for staleMin. Re-armed on start and on every
// ticked set; the server cannot do this itself because S.active is never synced.
export function armStale() {
  const { S } = useStore.getState()
  if (!notifyOn('stale') || !S.active) return
  post('/api/push/stale', { seconds: { ...DEF.notify, ...S.notify }.staleMin * 60, title: t('Still training?'), body: t("{0} is still open. Tap Finish so it's saved.", S.active.name) })
}
export const cancelStale = () => { if (useStore.getState().user) return post('/api/push/stale/cancel') }
// Both server alerts, e.g. when the error screen throws the running workout away.
export const cancelPushes = () => Promise.all([cancelPushRestTimer(), cancelStale()])

let timerInt = null
let timerTick = null
let workInt = null
let workTick = null
let workDone = null

export const useUI = create((set, get) => ({
  sheets: [],          // { id, render:(close)=>JSX, kind:'sheet'|'center', onDismiss }
  timer: null,         // rest countdown between sets — { left, total, endsAt }
  work: null,          // work countdown DURING a timed set (issue #16) — { left, total, endsAt, label }

  // onDismiss runs only when the user swipes the sheet away or taps the backdrop
  openSheet(render, { kind = 'sheet', onDismiss, finish, label } = {}) {
    const id = uid()
    set(s => ({ sheets: [...s.sheets, { id, render, kind, onDismiss, finish, label }] }))
    const close = () => get().closeSheet(id)
    return { id, close }
  },
  closeSheet(id) { set(s => ({ sheets: s.sheets.filter(x => x.id !== id) })) },
  closeAll() { set({ sheets: [] }) },

  toast(msg) { sonner(msg) },

  startRest(sec) {
    get().stopRest(true)   // the schedule below replaces the server job; no cancel needed
    const endsAt = Date.now() + sec * 1000
    set({ timer: { left: sec, total: sec, endsAt } })
    pushRestTimer(sec)
    timerTick = () => {
      const tm = get().timer
      if (!tm) return
      const left = Math.max(0, Math.round((tm.endsAt - Date.now()) / 1000))
      if (left === tm.left) return
      const snd = useStore.getState().S.sound
      if (left <= 0) {
        beep(snd, 880, 0.15); beep(snd, 880, 0.15, 0.25); beep(snd, 1320, 0.4, 0.5)
        vibrate([200, 100, 200]); get().toast(t('Rest over — next set!'))
        // iOS keeps a locked Home Screen app running: cancelling here would kill the push it needs
        get().stopRest(document.visibilityState === 'hidden'); return
      }
      if (left <= 3) beep(snd, 660, 0.1)
      set({ timer: { ...tm, left } })
    }
    timerInt = setInterval(timerTick, 1000)
    document.addEventListener('visibilitychange', timerTick)
  },
  addRest(sec) {
    const tm = get().timer
    if (!tm) return
    const left = tm.left + sec
    // taking off more than is left means "I'm ready now" — same as skipping, and it keeps a
    // negative duration out of both the progress bar and the server-side push schedule
    if (left <= 0) { get().stopRest(); return }
    set({ timer: { ...tm, left, total: tm.total + sec, endsAt: tm.endsAt + sec * 1000 } })
    pushRestTimer(left)
  },
  stopRest(keepPush) {
    if (timerInt) clearInterval(timerInt); timerInt = null
    if (timerTick) document.removeEventListener('visibilitychange', timerTick); timerTick = null
    if (get().timer && keepPush !== true) cancelPushRestTimer()   // === true: Skip passes the click event here
    set({ timer: null })
  },

  /* ---- work timer (issue #16) ----
     Times the set itself, not the recovery after it. Kept separate from the rest timer on
     purpose: the two mean opposite things, they must never run together, and a work set is
     something you are watching — so it gets no server push (that endpoint says "rest over",
     and a plank does not need a notification you are staring at anyway).
     `onDone(elapsedSec)` is called both when the countdown reaches zero and on an early
     finish; the elapsed time is what actually gets logged, so stopping at 0:38 of a 0:45
     hold records 0:38 rather than crediting the full target. */
  startWork(sec, label, onDone) {
    get().stopWork()
    get().stopRest()
    const total = Math.max(1, Math.round(sec) || 1)
    const endsAt = Date.now() + total * 1000
    workDone = onDone
    set({ work: { left: total, total, endsAt, label } })
    workTick = () => {
      const wk = get().work
      if (!wk) return
      const left = Math.max(0, Math.round((wk.endsAt - Date.now()) / 1000))
      if (left === wk.left) return
      const snd = useStore.getState().S.sound
      if (left <= 0) {
        beep(snd, 880, 0.15); beep(snd, 880, 0.15, 0.25); beep(snd, 1320, 0.4, 0.5)
        vibrate([200, 100, 200])
        const done = workDone
        get().stopWork()
        if (done) done(wk.total)
        return
      }
      if (left <= 3) beep(snd, 660, 0.1)
      set({ work: { ...wk, left } })
    }
    workInt = setInterval(workTick, 1000)
    document.addEventListener('visibilitychange', workTick)
  },
  // Ended the hold early — log what was actually held.
  finishWorkEarly() {
    const wk = get().work
    if (!wk) return
    const elapsed = Math.max(1, wk.total - wk.left)
    const done = workDone
    vibrate(30)
    get().stopWork()
    if (done) done(elapsed)
  },
  // Abandon without logging anything.
  stopWork() {
    if (workInt) clearInterval(workInt); workInt = null
    if (workTick) document.removeEventListener('visibilitychange', workTick); workTick = null
    workDone = null
    set({ work: null })
  }
}))
