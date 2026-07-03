import { SIZES } from '../config/theme.js'

const MIN_SPLIT_VIEW_WIDTH = 30

/**
 * Every width breakpoint the TUI responds to lives here, so a resize decision
 * is never buried inside a component: components receive a computed layout
 * (or call one `...ForWidth` helper) and only render what it grants them.
 */
export const TUI_LAYOUT = {
  body: {
    minSplitWidth: MIN_SPLIT_VIEW_WIDTH,
  },
  actionMenu: {
    fullWidthBelow: 100,
  },
  usageHeader: {
    minVisibleWidth: MIN_SPLIT_VIEW_WIDTH,
    minCompactWidth: 35,
    minFullWidth: 100,
    barWidth: 10,
  },
  projectPanel: {
    countMinWidth: 36,
    countMinColumnWidth: 4,
    groupColumnWidth: 14,
    minWidthWithoutCounts: 18,
    rowBreathingRoom: 1,
    rowCursorWidth: 2,
    rowHorizontalPadding: 2,
  },
  sessionPanel: {
    markerWidth: 2,
    minHeaderWidth: 16,
    minRelativeTimeWidth: 48,
    minExtendedSummaryWidth: 70,
  },
  resumeCard: {
    minCompactWidth: 48,
    minDecorationWidth: 48,
    minExtendedMetadataWidth: 38,
  },
  helpOverlay: {
    panelWidth: 60,
    outerPaddingX: 2,
    keyWidth: 14,
    compactKeyWidth: 8,
    compactMinWidth: 18,
  },
} as const

export interface ProjectPanelProject {
  groupName?: string
  path: string
  sessions: unknown[]
}

export type BodyLayoutMode = 'split' | 'single-panel' | 'full-width-actions' | 'full-width-preview'
export type UsageHeaderMode = 'full' | 'compact' | 'minimal' | 'hidden'

export interface ProjectPanelLayout {
  countColumnWidth: number
  showProjectGroups: boolean
  showSessionCounts: boolean
  width: number
}

export interface ProjectPanelLayoutOptions {
  showSessionCounts?: boolean
}

export interface ResolvedProjectPanelLayout extends ProjectPanelLayout {
  showRightBorder: boolean
}

export interface SessionPanelLayout {
  showExtendedSummary: boolean
  showHeader: boolean
  showRelativeTime: boolean
  width: number
}

export interface ResumeCardLayout {
  compact: boolean
  paddingX: number
  showDivider: boolean
  showExtendedMetadata: boolean
  showFiles: boolean
  showTags: boolean
  width: number
}

export interface UsageHeaderLayout {
  mode: UsageHeaderMode
  showBars: boolean
  showBrandProduct: boolean
  showLimitLabels: boolean
  showLimitsLabel: boolean
  showPercentage: boolean
  showReset: boolean
  showStatus: boolean
  showSummary: boolean
}

export interface AppToolbarLayout {
  showNavigationHints: boolean
}

export interface HelpOverlayLayout {
  compact: boolean
  keyWidth: number
  outerPaddingX: number
  panelPaddingX: number
  panelWidth: number
}

/**
 * The body panels the app shell lays out once per render. Full-terminal-width
 * chrome (header, toolbar, help overlay) self-measures through its own
 * `...ForWidth` helper instead, since it never depends on the panel split.
 */
export interface TuiViewportLayout {
  bodyMode: BodyLayoutMode
  projectPanel: ResolvedProjectPanelLayout
  resumeCard: ResumeCardLayout
  sessionPanel: SessionPanelLayout
  terminalWidth: number
}

export interface TuiViewportLayoutOptions {
  actionMenuOpen?: boolean
  projects?: ProjectPanelProject[]
  resumePreviewOpen?: boolean
  terminalWidth: number
}

export function compactProjectLabel(projectPath: string): string {
  return projectPath.split(/[/\\]/).filter(Boolean).slice(-2).join('/')
}

export function shouldUseSinglePanelLayout(terminalWidth: number): boolean {
  return terminalWidth < TUI_LAYOUT.body.minSplitWidth
}

export function helpOverlayLayoutForWidth(terminalWidth: number): HelpOverlayLayout {
  const overlay = TUI_LAYOUT.helpOverlay
  const compact = terminalWidth < overlay.panelWidth + overlay.outerPaddingX * 2
  return {
    compact,
    keyWidth: compact ? overlay.compactKeyWidth : overlay.keyWidth,
    outerPaddingX: compact ? 0 : overlay.outerPaddingX,
    panelPaddingX: compact ? 1 : 2,
    panelWidth: compact ? Math.max(overlay.compactMinWidth, terminalWidth) : overlay.panelWidth,
  }
}

export function shouldShowProjectSessionCounts(terminalWidth: number): boolean {
  return terminalWidth >= TUI_LAYOUT.projectPanel.countMinWidth
}

export function bodyLayoutModeForWidth(
  terminalWidth: number,
  options: { actionMenuOpen?: boolean; resumePreviewOpen?: boolean } = {}
): BodyLayoutMode {
  if (options.resumePreviewOpen) return 'full-width-preview'
  if (options.actionMenuOpen && terminalWidth < TUI_LAYOUT.actionMenu.fullWidthBelow) {
    return 'full-width-actions'
  }
  return shouldUseSinglePanelLayout(terminalWidth) ? 'single-panel' : 'split'
}

export function usageHeaderModeForWidth(width: number): UsageHeaderMode {
  if (width < TUI_LAYOUT.usageHeader.minVisibleWidth) return 'hidden'
  if (width < TUI_LAYOUT.usageHeader.minCompactWidth) return 'minimal'
  if (width < TUI_LAYOUT.usageHeader.minFullWidth) return 'compact'
  return 'full'
}

export function usageHeaderLayoutForWidth(width: number): UsageHeaderLayout {
  const mode = usageHeaderModeForWidth(width)
  return {
    mode,
    showBars: mode !== 'hidden',
    showBrandProduct: mode === 'full',
    showLimitLabels: mode !== 'minimal' && mode !== 'hidden',
    showLimitsLabel: mode !== 'minimal' && mode !== 'hidden',
    showPercentage: mode !== 'hidden',
    showReset: mode === 'full',
    showStatus: mode === 'full',
    showSummary: mode !== 'hidden',
  }
}

export function appToolbarLayoutForWidth(width: number): AppToolbarLayout {
  return {
    showNavigationHints: !shouldUseSinglePanelLayout(width),
  }
}

export function sessionPanelLayoutForWidth(panelWidth: number): SessionPanelLayout {
  return {
    showExtendedSummary: panelWidth >= TUI_LAYOUT.sessionPanel.minExtendedSummaryWidth,
    showHeader: panelWidth >= TUI_LAYOUT.sessionPanel.minHeaderWidth,
    showRelativeTime: panelWidth >= TUI_LAYOUT.sessionPanel.minRelativeTimeWidth,
    width: panelWidth,
  }
}

export function resumeCardLayoutForWidth(panelWidth: number): ResumeCardLayout {
  const compact = panelWidth < TUI_LAYOUT.resumeCard.minCompactWidth
  return {
    compact,
    paddingX: compact ? 1 : 2,
    showDivider: panelWidth >= TUI_LAYOUT.resumeCard.minDecorationWidth,
    showExtendedMetadata: panelWidth >= TUI_LAYOUT.resumeCard.minExtendedMetadataWidth,
    showFiles: panelWidth >= TUI_LAYOUT.resumeCard.minDecorationWidth,
    showTags: panelWidth >= TUI_LAYOUT.resumeCard.minDecorationWidth,
    width: panelWidth,
  }
}

export function projectSessionCountLabel(sessionCount: number): string {
  return ` (${sessionCount})`
}

export function projectCountColumnWidth(projects: ProjectPanelProject[]): number {
  return Math.max(
    TUI_LAYOUT.projectPanel.countMinColumnWidth,
    ...projects.map((project) => projectSessionCountLabel(project.sessions.length).length)
  )
}

export function projectPanelLayoutForTerminal(
  terminalWidth: number,
  projects: ProjectPanelProject[] = [],
  options: ProjectPanelLayoutOptions = {}
): ProjectPanelLayout {
  let layout: (typeof SIZES.projectPanelBreakpoints)[number] = SIZES.projectPanelBreakpoints[0]
  for (const candidate of SIZES.projectPanelBreakpoints) {
    if (terminalWidth >= candidate.minTerminalWidth) layout = candidate
  }

  const showSessionCounts =
    options.showSessionCounts ?? shouldShowProjectSessionCounts(terminalWidth)
  const naturalCountColumnWidth = projectCountColumnWidth(projects)
  const countColumnWidth = showSessionCounts ? naturalCountColumnWidth : 0
  const baseWidth = showSessionCounts
    ? layout.projectPanelWidth
    : Math.max(
        TUI_LAYOUT.projectPanel.minWidthWithoutCounts,
        layout.projectPanelWidth - naturalCountColumnWidth
      )
  const fixedRowWidth =
    TUI_LAYOUT.projectPanel.rowHorizontalPadding +
    TUI_LAYOUT.projectPanel.rowCursorWidth +
    TUI_LAYOUT.projectPanel.rowBreathingRoom +
    countColumnWidth
  const longestProjectLabel = Math.max(
    0,
    ...projects.map((project) => compactProjectLabel(project.path).length)
  )
  const showProjectGroups =
    'showProjectGroups' in layout &&
    layout.showProjectGroups === true &&
    (projects.length === 0 || projects.some((project) => project.groupName))
  const contentWidth =
    fixedRowWidth +
    longestProjectLabel +
    (showProjectGroups ? TUI_LAYOUT.projectPanel.groupColumnWidth : 0)
  const sessionSafeMaxWidth = Math.max(baseWidth, terminalWidth - SIZES.sessionDetailsMinWidth)
  const proportionalMaxWidth = Math.max(baseWidth, Math.floor(terminalWidth * 0.42))
  const maxWidth = Math.min(SIZES.maxProjectPanelWidth, sessionSafeMaxWidth, proportionalMaxWidth)

  return {
    countColumnWidth,
    showProjectGroups,
    showSessionCounts,
    width: Math.max(baseWidth, Math.min(contentWidth, maxWidth)),
  }
}

export function tuiViewportLayoutForWidth({
  actionMenuOpen = false,
  projects = [],
  resumePreviewOpen = false,
  terminalWidth,
}: TuiViewportLayoutOptions): TuiViewportLayout {
  const bodyMode = bodyLayoutModeForWidth(terminalWidth, { actionMenuOpen, resumePreviewOpen })
  const baseProjectPanel = projectPanelLayoutForTerminal(terminalWidth, projects)
  const bodyUsesSingleSlot = bodyMode !== 'split'
  const projectPanelWidth = bodyUsesSingleSlot ? terminalWidth : baseProjectPanel.width
  const sessionPanelWidth = bodyUsesSingleSlot
    ? terminalWidth
    : Math.max(0, terminalWidth - baseProjectPanel.width)

  return {
    bodyMode,
    projectPanel: {
      ...baseProjectPanel,
      showRightBorder: bodyMode === 'split',
      width: projectPanelWidth,
    },
    resumeCard: resumeCardLayoutForWidth(terminalWidth),
    sessionPanel: sessionPanelLayoutForWidth(sessionPanelWidth),
    terminalWidth,
  }
}

/** Organization metadata is decorative in the TUI and only earns space on very wide terminals. */
export function shouldShowProjectGroups(terminalWidth: number): boolean {
  return projectPanelLayoutForTerminal(terminalWidth).showProjectGroups
}

export function projectPanelWidthForTerminal(terminalWidth: number): number {
  return projectPanelLayoutForTerminal(terminalWidth).width
}
