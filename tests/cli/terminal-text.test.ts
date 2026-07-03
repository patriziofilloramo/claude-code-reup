import { describe, expect, it } from 'vitest'

import {
  clipVisible,
  formatSingleLineRow,
  padVisibleEnd,
  stripAnsi,
  truncateVisible,
  truncateVisibleStart,
  visibleLength,
} from '../../src/cli/terminal-text.js'

const GREEN = '[32m'
const RESET = '[0m'

describe('terminal-text', () => {
  it('truncates plain text and appends an ellipsis once it no longer fits', () => {
    expect(truncateVisible('session about responsive layout work', 12)).toBe('session a...')
    expect(truncateVisible('short', 12)).toBe('short')
  })

  it('clips without an ellipsis and never exceeds the requested width', () => {
    expect(clipVisible('session about responsive layout work', 12)).toBe('session abou')
    expect(visibleLength(clipVisible('session about responsive layout work', 12))).toBe(12)
  })

  it('leaves short colorized values untouched', () => {
    const value = `${GREEN}●${RESET}`
    expect(clipVisible(value, 8)).toBe(value)
    expect(truncateVisible(value, 8)).toBe(value)
  })

  it('never splits a colorized value mid-escape-sequence when it must cut', () => {
    const value = `${GREEN}active session${RESET}`
    const clipped = clipVisible(value, 6)
    // The visible (post-strip) text must match a clean prefix, and any
    // partially-applied style must be closed rather than leaking into
    // whatever the caller concatenates after this cell.
    expect(stripAnsi(clipped)).toBe('active')
    expect(visibleLength(clipped)).toBe(6)
    if (clipped.includes(GREEN)) expect(clipped.endsWith(RESET)).toBe(true)
  })

  it('keeps the tail (e.g. a filename) when truncating from the start', () => {
    const path = 'src/core/session/session-query.ts'
    const result = truncateVisibleStart(path, 20)
    expect(result.endsWith('session-query.ts')).toBe(true)
    expect(result.startsWith('...')).toBe(true)
  })

  it('pads by visible width, ignoring ANSI codes', () => {
    const value = `${GREEN}ok${RESET}`
    expect(padVisibleEnd(value, 5)).toBe(`${value}   `)
  })

  it('keeps the separator space between a marker prefix and the primary text', () => {
    const row = formatSingleLineRow({
      coreParts: ['00000000'],
      prefix: '○ ',
      primary: 'Session',
      width: 40,
    })
    expect(row).toContain('○ Session')
  })

  it('keeps the double-space gap between the primary column and its metadata', () => {
    const row = formatSingleLineRow({
      metadataParts: ['my-project'],
      prefix: '○ ',
      primary: 'Session',
      width: 40,
    })
    expect(row).toContain('Session  my-project')
  })

  it('drops metadata parts from the end, one at a time, before shrinking the primary column past its minimum', () => {
    const wide = formatSingleLineRow({
      metadataParts: ['5 hits', 'my-project'],
      prefix: '● ',
      primary: 'A very long session name that needs room',
      primaryMinWidth: 20,
      width: 30,
    })
    expect(wide).toContain('5 hits')
    expect(wide).not.toContain('my-project')

    const narrow = formatSingleLineRow({
      metadataParts: ['5 hits', 'my-project'],
      prefix: '● ',
      primary: 'A very long session name that needs room',
      primaryMinWidth: 20,
      width: 22,
    })
    expect(narrow).not.toContain('5 hits')
    expect(narrow).not.toContain('my-project')
  })
})
