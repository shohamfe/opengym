import { it, expect, vi } from 'vitest'

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
globalThis.document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} }

// Each call resolves only when released, so the test sees whether the next one waited for it.
const calls = [], pending = []
vi.mock('../lib/api.js', () => ({ api: vi.fn(path => { calls.push(path); return new Promise(r => pending.push(r)) }) }))
const drain = async () => { while (pending.length) { pending.shift()({}); await new Promise(r => setTimeout(r)) } }

it('re-schedules the rest alert without a cancel, one request at a time; Skip cancels', async () => {
  const { useStore } = await import('./useStore.js')
  const { useUI } = await import('./useUI.js')
  useStore.setState({ user: { id: 'u1' } })
  const ui = useUI.getState()
  ui.startRest(90)
  ui.startRest(60)            // next set started while the rest was still counting
  await new Promise(r => setTimeout(r))
  expect(calls).toEqual(['/api/push/rest-timer'])   // the second waits for the first
  await drain()
  expect(calls).toEqual(['/api/push/rest-timer', '/api/push/rest-timer'])
  ui.stopRest({ type: 'click' })   // Skip button hands its click event to stopRest
  await drain()
  expect(calls.at(-1)).toBe('/api/push/rest-timer/cancel')
  ui.stopRest()
  useStore.setState(s => ({ S: { ...s.S, notify: { ...s.S.notify, rest: false } } }))
  ui.startRest(30)
  await drain()
  expect(calls.length).toBe(3)    // switched off: nothing scheduled
  ui.stopRest()
})

it('keeps the rest alert when the timer ends while the app is hidden', async () => {
  const { useStore } = await import('./useStore.js')
  const { useUI } = await import('./useUI.js')
  useStore.setState(s => ({ S: { ...s.S, notify: { ...s.S.notify, rest: true } } }))
  globalThis.document.visibilityState = 'hidden'
  useUI.getState().startRest(1)
  await new Promise(r => setTimeout(r, 1200))
  await drain()
  expect(useUI.getState().timer).toBe(null)
  expect(calls.at(-1)).toBe('/api/push/rest-timer')   // ended on its own, no cancel sent
  globalThis.document.visibilityState = 'visible'
})
