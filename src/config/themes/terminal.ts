import type { ThemeTokens } from '../theme-tokens.js'

/**
 * Terminal / phosphor theme.
 *
 * Near-black background with phosphor-green text — evokes classic VT100/VT220
 * terminals. Signals "made for people who live in the command line" without
 * sacrificing legibility. The web UI adds a subtle scan-line overlay via
 * scanlineOpacity; the TUI approximates the aesthetic through colour alone.
 *
 * Easter egg: holding the "ccm" logo element for ≥3 s triggers a Matrix rain
 * animation (web only). The scan-line is always on; the rain is opt-in theatre.
 */
export const terminalTheme: ThemeTokens = {
  name: 'terminal',

  // Brand colours — phosphor palette
  bg: '#050a05',
  surface: '#080f08',
  dim: '#0f1f0f',
  muted: '#1f3d1f',
  muted2: '#3a6b3a',
  text: '#a0c8a0',      // phosphor mid — readable, not eye-searing
  strong: '#c8ffc8',    // bright phosphor for emphasis
  accent: '#00ff41',    // classic matrix green
  green: '#00e532',
  amber: '#b8ff00',     // phosphor amber-green hybrid
  orange: '#80ff00',
  red: '#ff3300',       // red phosphor (error state only)

  // Surface layers
  surfaceRaised: '#0a140a',
  surfaceDeep: '#0d1a0d',
  overlay: 'rgba(0, 10, 0, 0.80)',
  shadowDlg: '0 8px 40px rgba(0, 255, 65, 0.08)',

  // Interaction tints (green-tinted)
  rowHover: 'rgba(0, 255, 65, 0.03)',
  rowHoverSm: 'rgba(0, 255, 65, 0.02)',
  surfaceChip: 'rgba(0, 255, 65, 0.05)',
  surfaceBtn: 'rgba(0, 255, 65, 0.07)',
  surfaceBtnHover: 'rgba(0, 255, 65, 0.12)',

  // Accent-derived
  accentD: 'rgb(0 255 65 / 0.06)',
  accentHi: '#33ff66',
  accentFg: '#000000',

  // RGB channel values
  accentRgb: '0 255 65',
  amberRgb: '184 255 0',
  redRgb: '255 51 0',
  dimRgb: '15 31 15',

  // Web-only: CRT scan-line overlay intensity (0–1)
  scanlineOpacity: 0.04,
}
