import { SIZES } from '../config/theme.js'

/** Organization metadata is decorative in the TUI and only earns space on very wide terminals. */
export function shouldShowProjectGroups(terminalWidth: number): boolean {
  return terminalWidth >= SIZES.projectGroupMinTerminalWidth
}

export function projectPanelWidthForTerminal(terminalWidth: number): number {
  return shouldShowProjectGroups(terminalWidth)
    ? SIZES.wideProjectPanelWidth
    : SIZES.projectPanelWidth
}
