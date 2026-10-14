import { describe, it, expect } from 'vitest'
import { notifyState } from './push.js'

const base = { user: { id: 'u' }, supported: true, ios: true, installed: true, perm: 'granted', subscribed: true }

describe('notifyState', () => {
  it('walks the states in order', () => {
    expect(notifyState({ ...base, user: null, supported: false })).toBe('guest')
    expect(notifyState({ ...base, supported: false, installed: false })).toBe('install')
    expect(notifyState({ ...base, supported: false })).toBe('oldIos')
    expect(notifyState({ ...base, supported: false, ios: false })).toBe('unsupported')
    expect(notifyState({ ...base, perm: 'denied' })).toBe('denied')
    expect(notifyState({ ...base, subscribed: false })).toBe('off')
    expect(notifyState(base)).toBe('on')
  })
})
