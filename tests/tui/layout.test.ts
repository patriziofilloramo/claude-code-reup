import { describe, expect, it } from 'vitest'

import {
  bodyLayoutModeForWidth,
  projectCountColumnWidth,
  projectPanelLayoutForTerminal,
  projectPanelWidthForTerminal,
  projectSessionCountLabel,
  resumeCardLayoutForWidth,
  sessionPanelLayoutForWidth,
  shouldShowProjectSessionCounts,
  shouldUseSinglePanelLayout,
  shouldShowProjectGroups,
  tuiViewportLayoutForWidth,
} from '../../src/tui/layout.js'

describe('TUI responsive layout', () => {
  it('uses one full-width panel once the terminal becomes too narrow for split view', () => {
    expect(shouldUseSinglePanelLayout(29)).toBe(true)
    expect(shouldUseSinglePanelLayout(30)).toBe(false)
    expect(shouldUseSinglePanelLayout(35)).toBe(false)
    expect(shouldUseSinglePanelLayout(120)).toBe(false)
    expect(bodyLayoutModeForWidth(29)).toBe('single-panel')
    expect(bodyLayoutModeForWidth(30)).toBe('split')
    expect(bodyLayoutModeForWidth(120, { resumePreviewOpen: true })).toBe('full-width-preview')
  })

  it('drops project session counts only in the ultra-narrow project view', () => {
    expect(shouldShowProjectSessionCounts(35)).toBe(false)
    expect(shouldShowProjectSessionCounts(36)).toBe(true)
    expect(shouldShowProjectSessionCounts(120)).toBe(true)
  })

  it('bases session row detail on the actual session panel width', () => {
    expect(sessionPanelLayoutForWidth(13)).toEqual({
      showExtendedSummary: false,
      showHeader: false,
      showRelativeTime: false,
      width: 13,
    })
    expect(sessionPanelLayoutForWidth(16)).toMatchObject({ showHeader: true })
    expect(sessionPanelLayoutForWidth(39)).toEqual({
      showExtendedSummary: false,
      showHeader: true,
      showRelativeTime: false,
      width: 39,
    })
    expect(sessionPanelLayoutForWidth(48)).toEqual({
      showExtendedSummary: false,
      showHeader: true,
      showRelativeTime: true,
      width: 48,
    })
    expect(sessionPanelLayoutForWidth(70)).toEqual({
      showExtendedSummary: true,
      showHeader: true,
      showRelativeTime: true,
      width: 70,
    })
  })

  it('keeps resume preview readable with a compact card mode', () => {
    expect(resumeCardLayoutForWidth(34)).toEqual({
      compact: true,
      paddingX: 1,
      showDivider: false,
      showExtendedMetadata: false,
      showFiles: false,
      showTags: false,
      width: 34,
    })
    expect(resumeCardLayoutForWidth(48)).toEqual({
      compact: false,
      paddingX: 2,
      showDivider: true,
      showExtendedMetadata: true,
      showFiles: true,
      showTags: true,
      width: 48,
    })
  })

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
      countColumnWidth: 5,
      showProjectGroups: false,
      showSessionCounts: true,
      width: 38,
    })
    expect(projectPanelLayoutForTerminal(260, projects)).toEqual({
      countColumnWidth: 5,
      showProjectGroups: false,
      showSessionCounts: true,
      width: 42,
    })
  })

  it('keeps project counts aligned without reserving unused narrow-terminal columns', () => {
    const projects = [
      { path: 'Apps/claude-sessions-manager', sessions: Array.from({ length: 26 }) },
      { path: 'Apps/Test', sessions: Array.from({ length: 1 }) },
    ]

    expect(projectSessionCountLabel(26)).toBe(' (26)')
    expect(projectCountColumnWidth(projects)).toBe(5)
    expect(projectPanelLayoutForTerminal(48, projects)).toMatchObject({
      countColumnWidth: 5,
      width: 26,
    })
    expect(projectPanelLayoutForTerminal(34, projects, { showSessionCounts: false })).toMatchObject(
      {
        countColumnWidth: 0,
        showSessionCounts: false,
        width: 21,
      }
    )
  })

  it('shows project groups only at ultra-wide widths with a dedicated wide project panel', () => {
    expect(shouldShowProjectGroups(260)).toBe(false)
    expect(shouldShowProjectGroups(299)).toBe(false)
    expect(shouldShowProjectGroups(300)).toBe(true)
    expect(projectPanelLayoutForTerminal(300)).toEqual({
      countColumnWidth: 4,
      showProjectGroups: true,
      showSessionCounts: true,
      width: 56,
    })
    expect(
      projectPanelLayoutForTerminal(360, [
        { groupName: 'Fantastic', path: 'Apps/claude-sessions-manager', sessions: [] },
      ])
    ).toEqual({
      countColumnWidth: 4,
      showProjectGroups: true,
      showSessionCounts: true,
      width: 56,
    })
  })

  it('resolves the root viewport layout once for the app shell', () => {
    const projects = [
      { path: 'Apps/claude-sessions-manager', sessions: Array.from({ length: 26 }) },
      { path: 'Apps/Test', sessions: Array.from({ length: 1 }) },
    ]

    expect(tuiViewportLayoutForWidth({ terminalWidth: 34, projects })).toMatchObject({
      bodyMode: 'split',
      projectPanel: {
        countColumnWidth: 0,
        showRightBorder: true,
        showSessionCounts: false,
        width: 21,
      },
      sessionPanel: {
        showHeader: false,
        width: 13,
      },
      terminalWidth: 34,
    })

    expect(tuiViewportLayoutForWidth({ terminalWidth: 29, projects })).toMatchObject({
      bodyMode: 'single-panel',
      projectPanel: {
        showRightBorder: false,
        width: 29,
      },
      sessionPanel: {
        width: 29,
      },
    })

    expect(
      tuiViewportLayoutForWidth({ terminalWidth: 120, projects, resumePreviewOpen: true })
    ).toMatchObject({
      bodyMode: 'full-width-preview',
      projectPanel: {
        showRightBorder: false,
      },
      resumeCard: {
        width: 120,
      },
    })
  })

  it('lets action menus claim the full body width below 100 columns', () => {
    const projects = [
      { path: 'Apps/claude-sessions-manager', sessions: Array.from({ length: 26 }) },
    ]

    expect(
      tuiViewportLayoutForWidth({ terminalWidth: 99, projects, actionMenuOpen: true })
    ).toMatchObject({
      bodyMode: 'full-width-actions',
      projectPanel: {
        showRightBorder: false,
        width: 99,
      },
      sessionPanel: {
        width: 99,
      },
    })

    expect(
      tuiViewportLayoutForWidth({ terminalWidth: 100, projects, actionMenuOpen: true })
    ).toMatchObject({
      bodyMode: 'split',
      projectPanel: {
        showRightBorder: true,
      },
    })
  })
})
