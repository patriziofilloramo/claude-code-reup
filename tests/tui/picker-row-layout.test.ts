import { describe, expect, it } from 'vitest'

import {
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
      showQuaternaryMeta: false,
      width: 56,
    })
    expect(pickerRowLayoutForWidth(82)).toMatchObject({
      primaryWidth: 55,
      showPrimaryMeta: true,
      showSecondaryMeta: true,
      showTertiaryMeta: false,
    })
    expect(pickerRowLayoutForWidth(120)).toMatchObject({
      primaryWidth: 65,
      showPrimaryMeta: true,
      showSecondaryMeta: true,
      showTertiaryMeta: true,
      showQuaternaryMeta: true,
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
