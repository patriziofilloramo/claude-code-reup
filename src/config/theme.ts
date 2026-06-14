/**
 * TUI design tokens.
 * CSS equivalents live in src/web/styles.css as :root custom properties.
 * Keep both files in sync when changing colours.
 */
export const COLORS = {
  accent: '#22d3ee',
  border: '#2a2a2a',
  danger: '#f87171',
  dim: '#4a4a4a',
  muted: '#686868',
  ok: '#34d399',
  orange: '#fb923c',
  text: '#f0f0f0',
  textSub: '#c8c8c8',
  warn: '#fbbf24',
} as const

export const SIZES = {
  projectPanelWidth: 30,
  sessionDetailsMinWidth: 72,
} as const
