import { describe, it, expect } from 'vitest'
import { startOfWeek, weekKey, weekOrder, isoOf } from './format.js'

describe('first day of week', () => {
  it('a Sunday starts its own week when weeks start on Sunday, ends the week otherwise', () => {
    // 2026-10-11 is a Sunday
    expect(weekKey('2026-10-11', 0)).toBe('2026-10-11')
    expect(weekKey('2026-10-11', 1)).toBe('2026-10-05')
    expect(weekKey('2026-10-11')).toBe('2026-10-05')
    expect(startOfWeek(new Date(2026, 9, 11, 23, 30), 0).getHours()).toBe(12)
  })
  it('crosses the year boundary', () => {
    // 2027-01-01 is a Friday
    expect(isoOf(startOfWeek('2027-01-01T12:00:00', 1))).toBe('2026-12-28')
    expect(weekKey('2027-01-01', 0)).toBe('2026-12-27')
    expect(weekKey('2026-12-31', 1)).toBe(weekKey('2027-01-03', 1))
    expect(weekKey('2027-01-03', 0)).not.toBe(weekKey('2027-01-02', 0))
  })
  it('orders the days from the first one', () => {
    expect(weekOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(weekOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})
