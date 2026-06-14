import { describe, expect, it } from 'vitest'

import { relativeTime } from '../../src/utils/time.js'

const SECOND_MS = 1_000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

function timestampAgo(elapsedMs: number): string {
  return new Date(Date.now() - elapsedMs).toISOString()
}

describe('relativeTime', () => {
  it('returns "just now" for timestamps under one minute old', () => {
    expect(relativeTime(timestampAgo(30 * SECOND_MS))).toBe('just now')
    expect(relativeTime(timestampAgo(59 * SECOND_MS))).toBe('just now')
  })

  it('returns minutes for timestamps under one hour old', () => {
    expect(relativeTime(timestampAgo(1 * MINUTE_MS))).toBe('1m ago')
    expect(relativeTime(timestampAgo(59 * MINUTE_MS))).toBe('59m ago')
  })

  it('returns hours for timestamps under one day old', () => {
    expect(relativeTime(timestampAgo(1 * HOUR_MS))).toBe('1h ago')
    expect(relativeTime(timestampAgo(23 * HOUR_MS))).toBe('23h ago')
  })

  it('returns days for timestamps under one month old', () => {
    expect(relativeTime(timestampAgo(1 * DAY_MS))).toBe('1d ago')
    expect(relativeTime(timestampAgo(29 * DAY_MS))).toBe('29d ago')
  })

  it('returns months for timestamps under one year old', () => {
    expect(relativeTime(timestampAgo(35 * DAY_MS))).toBe('1mo ago')
    expect(relativeTime(timestampAgo(330 * DAY_MS))).toBe('11mo ago')
  })

  it('returns years for older timestamps', () => {
    expect(relativeTime(timestampAgo(370 * DAY_MS))).toBe('1y ago')
    expect(relativeTime(timestampAgo(800 * DAY_MS))).toBe('2y ago')
  })
})
