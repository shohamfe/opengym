import { describe, it, expect, beforeAll } from 'vitest'
import { renderToString } from 'react-dom/server'

// The store touches these at import time (same stubs as useStore.sync.test.js).
const ls = {}
globalThis.localStorage = { getItem: k => ls[k] ?? null, setItem: (k, v) => { ls[k] = String(v) }, removeItem: k => { delete ls[k] } }
globalThis.document = { visibilityState: 'visible', addEventListener: () => {} }

let useUI, aiSheet, pasteSheet, reviewSheet, matchExercises
beforeAll(async () => {
  ;({ useUI } = await import('./store/useUI.js'))
  ;({ aiSheet, pasteSheet, reviewSheet } = await import('./ai-sheets.jsx'))
  ;({ matchExercises } = await import('./lib/ai-import.js'))
})

// Smoke render: each sheet's first frame renders without throwing.
const render = () => { const s = useUI.getState().sheets; const html = renderToString(s[s.length - 1].render(() => {})); useUI.getState().closeAll(); return html }

describe('Build with AI sheets', () => {
  it('entry, paste and review render', () => {
    aiSheet()
    expect(render()).toContain('Copy prompt for your AI')
    pasteSheet()
    expect(render()).toContain('Check plan')
    const m = matchExercises({ opengym_plan: 1, routines: [{ name: 'A', ex: [{ id: '0251', name: 'push-up' }, { name: 'zzzz qqqq' }, { id: '0662', name: 'push-up' }] }], week: { 1: 'R1' } }, { unit: 'kg', routines: [], customEx: [] })
    reviewSheet(m, 2)
    const html = render()
    expect(html).toContain('Resolve 2 more')
    expect(html).toContain('Found 2 plans')
    expect(html).toContain('Skip this exercise')
  })
})
