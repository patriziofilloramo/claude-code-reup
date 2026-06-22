import { describe, expect, it } from 'vitest'

import { projectPanelWidthForTerminal, shouldShowProjectGroups } from '../../src/tui/layout.js'

describe('TUI responsive layout', () => {
  it('hides project groups at ordinary desktop widths', () => {
    expect(shouldShowProjectGroups(120)).toBe(false)
    expect(shouldShowProjectGroups(179)).toBe(false)
    expect(projectPanelWidthForTerminal(179)).toBe(30)
  })

  it('shows project groups only when the project panel can grow safely', () => {
    expect(shouldShowProjectGroups(180)).toBe(true)
    expect(projectPanelWidthForTerminal(180)).toBe(44)
    expect(projectPanelWidthForTerminal(240)).toBe(44)
  })
})
