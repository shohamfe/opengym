import { it, expect } from 'vitest'
import { normCode, fmtCode, authError } from './codes.js'

it('normalises codes the way the server hashes them', () => {
  expect(normCode(' k7qx-29md 4hnp ')).toBe('K7QX29MD4HNP')
  expect(normCode('IL0O')).toBe('1100')
  expect(normCode('K7QX29MD4HNPXTRA')).toBe('K7QX29MD4HNP')
  expect(normCode(null)).toBe('')
})

it('groups codes 4-4-4 while typing or pasting', () => {
  expect(fmtCode('k7q')).toBe('K7Q')
  expect(fmtCode('K7QX')).toBe('K7QX')
  expect(fmtCode('K7QX-')).toBe('K7QX')            // backspace over the hyphen works
  expect(fmtCode('K7QX2')).toBe('K7QX-2')
  expect(fmtCode('k7qx 29md-4hnp')).toBe('K7QX-29MD-4HNP')
  expect(fmtCode('')).toBe('')
})

it('maps auth errors to one message each', () => {
  const join = e => authError(e, 'join')
  expect(join({ status: 500, message: 'Database error saving new user' })).toBe('That code is wrong, expired or already used.')
  expect(join({ status: 422, code: 'user_already_exists' })).toBe('This email already has an account. Sign in instead.')
  expect(join({ status: 422, code: 'weak_password' })).toBe('Use at least 10 characters.')
  expect(join({ status: 429 })).toBe('Too many tries. Wait a few minutes and try again.')
  expect(join({ status: 0 })).toMatch(/offline/)
  expect(authError({ status: 403 }, 'reset')).toBe('That code is wrong, expired or already used.')
  expect(authError({ status: 502 }, 'reset')).toBe('Sign-in failed')
  expect(authError({ status: 400 }, 'in')).toBe('Wrong email or password.')
})
