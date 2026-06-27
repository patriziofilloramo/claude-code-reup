import { SIZES } from '../config/theme.js'

interface ProjectPanelProject {
  groupName?: string
  path: string
  sessions: unknown[]
}

export interface ProjectPanelLayout {
  width: number
  showProjectGroups: boolean
}

export function compactProjectLabel(projectPath: string): string {
  return projectPath.split(/[/\\]/).filter(Boolean).slice(-2).join('/')
}

export function projectPanelLayoutForTerminal(
  terminalWidth: number,
  projects: ProjectPanelProject[] = []
): ProjectPanelLayout {
  let layout: (typeof SIZES.projectPanelBreakpoints)[number] = SIZES.projectPanelBreakpoints[0]
  for (const candidate of SIZES.projectPanelBreakpoints) {
    if (terminalWidth >= candidate.minTerminalWidth) layout = candidate
  }

  const baseWidth = layout.projectPanelWidth
  const fixedRowWidth = 17 // padding + cursor + breathing room + cloud slot + count slot
  const groupWidth = 15
  const longestProjectLabel = Math.max(
    0,
    ...projects.map((project) => compactProjectLabel(project.path).length)
  )
  const showProjectGroups =
    'showProjectGroups' in layout &&
    layout.showProjectGroups === true &&
    (projects.length === 0 || projects.some((project) => project.groupName))
  const contentWidth = fixedRowWidth + longestProjectLabel + (showProjectGroups ? groupWidth : 0)
  const sessionSafeMaxWidth = Math.max(baseWidth, terminalWidth - SIZES.sessionDetailsMinWidth)
  const proportionalMaxWidth = Math.max(baseWidth, Math.floor(terminalWidth * 0.42))
  const maxWidth = Math.min(SIZES.maxProjectPanelWidth, sessionSafeMaxWidth, proportionalMaxWidth)

  return {
    width: Math.max(baseWidth, Math.min(contentWidth, maxWidth)),
    showProjectGroups,
  }
}

/** Organization metadata is decorative in the TUI and only earns space on very wide terminals. */
export function shouldShowProjectGroups(terminalWidth: number): boolean {
  return projectPanelLayoutForTerminal(terminalWidth).showProjectGroups
}

export function projectPanelWidthForTerminal(terminalWidth: number): number {
  return projectPanelLayoutForTerminal(terminalWidth).width
}
