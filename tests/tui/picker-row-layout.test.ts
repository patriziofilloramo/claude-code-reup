import { describe, expect, it } from 'vitest'

import {
  maximumVisibleItemPairsForTerminal,
  maximumVisibleRowsForTerminal,
  pickerRowLayoutForWidth,
  pickerSessionRowLayoutForWidth,
} from '../../src/tui/picker-row-layout.js'

describe('TUI picker row layout', () => {
  it('adds metadata gradually while keeping a fixed single-line row contract', () => {
    expect(pickerRowLayoutForWidth(40)).toMatchObject({
      coreMetaWidth: 8,
      primaryWidth: 48,
      showPrimaryMeta: false,
      showSecondaryMeta: false,
      showTertiaryMeta: false,
      width: 56,
    })
    expect(pickerRowLayoutForWidth(82)).toMatchObject({
      primaryWidth: 55,
      showPrimaryMeta: true,
      showSecondaryMeta: true,
      showTertiaryMeta: false,
    })
    expect(pickerRowLayoutForWidth(120)).toMatchObject({
      primaryWidth: 72,
      showPrimaryMeta: true,
      showSecondaryMeta: true,
      showTertiaryMeta: true,
      width: 120,
    })
  })

  it('reserves core ID space for session rows before optional metadata', () => {
    expect(pickerSessionRowLayoutForWidth(40)).toMatchObject({
      coreMetaWidth: 8,
      primaryWidth: 39,
      showPrimaryMeta: false,
      showSecondaryMeta: false,
      width: 56,
    })
  })
})

describe('maximumVisibleRowsForTerminal', () => {
  it('gives the list all the room the terminal has once chrome is reserved', () => {
    expect(maximumVisibleRowsForTerminal(24, 7, 20)).toBe(17)
  })

  it('falls back to the given terminal-row estimate when rows is undefined', () => {
    expect(maximumVisibleRowsForTerminal(undefined, 7, 20)).toBe(13)
  })

  it('shrinks to a single row on a short terminal instead of forcing a fixed minimum', () => {
    // Regression: a hard floor of 4 (regardless of terminal size) made the
    // rendered frame taller than the terminal on short screens — Ink then
    // scrolled the title/search line off-screen once the frame no longer
    // fit. Below chromeRows + 1, a single row is the best any layout can do.
    expect(maximumVisibleRowsForTerminal(9, 7, 20)).toBe(2)
    expect(maximumVisibleRowsForTerminal(8, 7, 20)).toBe(1)
    expect(maximumVisibleRowsForTerminal(6, 7, 20)).toBe(1)
    expect(maximumVisibleRowsForTerminal(4, 7, 20)).toBe(1)
  })
})

describe('maximumVisibleItemPairsForTerminal', () => {
  it('divides the available rows by two for double-row items', () => {
    expect(maximumVisibleItemPairsForTerminal(24, 6, 20)).toBe(9)
  })

  it('never drops below one visible item even on a very short terminal', () => {
    for (const rows of [4, 5, 6, 7, 8]) {
      expect(maximumVisibleItemPairsForTerminal(rows, 6, 20)).toBeGreaterThanOrEqual(1)
    }
  })
})
