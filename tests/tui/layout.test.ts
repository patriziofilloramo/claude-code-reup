import { describe, expect, it } from 'vitest'

import {
  projectPanelLayoutForTerminal,
  projectPanelWidthForTerminal,
  shouldShowProjectGroups,
} from '../../src/tui/layout.js'

describe('TUI responsive layout', () => {
  it('uses several project-panel breakpoints before sacrificing session space', () => {
    expect(projectPanelWidthForTerminal(80)).toBe(26)
    expect(projectPanelWidthForTerminal(120)).toBe(30)
    expect(projectPanelWidthForTerminal(160)).toBe(34)
    expect(projectPanelWidthForTerminal(200)).toBe(38)
    expect(projectPanelWidthForTerminal(260)).toBe(42)
  })

  it('grows the project panel from visible project names while preserving session space', () => {
    const projects = [
      { path: 'Apps/claude-sessions-manager', sessions: Array.from({ length: 11 }) },
      { path: 'Apps/Test', sessions: Array.from({ length: 1 }) },
    ]

    expect(projectPanelLayoutForTerminal(200, projects)).toEqual({
      width: 45,
      showProjectGroups: false,
    })
    expect(projectPanelLayoutForTerminal(260, projects)).toEqual({
      width: 45,
      showProjectGroups: false,
    })
  })

  it('shows project groups only at ultra-wide widths with a dedicated wide project panel', () => {
    expect(shouldShowProjectGroups(260)).toBe(false)
    expect(shouldShowProjectGroups(299)).toBe(false)
    expect(shouldShowProjectGroups(300)).toBe(true)
    expect(projectPanelLayoutForTerminal(300)).toEqual({ width: 56, showProjectGroups: true })
    expect(
      projectPanelLayoutForTerminal(360, [
        { groupName: 'Fantastic', path: 'Apps/claude-sessions-manager', sessions: [] },
      ])
    ).toEqual({ width: 60, showProjectGroups: true })
  })
})
