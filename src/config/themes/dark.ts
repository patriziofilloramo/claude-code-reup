import type { ThemeTokens } from '../theme-tokens.js'

export const darkTheme: ThemeTokens = {
  name: 'dark',

  // Brand colours
  bg: '#0c0c0c',
  surface: '#131313',
  dim: '#2a2a2a',
  muted: '#4a4a4a',
  muted2: '#686868',
  text: '#c8c8c8',
  strong: '#f0f0f0',
  accent: '#22d3ee',
  green: '#34d399',
  amber: '#fbbf24',
  orange: '#fb923c',
  red: '#f87171',

  // Surface layers
  surfaceRaised: '#141414',
  surfaceDeep: '#1a1a1a',
  overlay: 'rgba(0, 0, 0, 0.72)',
  shadowDlg: '0 8px 40px rgba(0, 0, 0, 0.6)',

  // Interaction tints (white-based)
  rowHover: 'rgba(255, 255, 255, 0.025)',
  rowHoverSm: 'rgba(255, 255, 255, 0.02)',
  surfaceChip: 'rgba(255, 255, 255, 0.04)',
  surfaceBtn: 'rgba(255, 255, 255, 0.06)',
  surfaceBtnHover: 'rgba(255, 255, 255, 0.10)',

  // Accent-derived
  accentD: 'rgb(34 211 238 / 0.08)',
  accentHi: '#38e8ff',
  accentFg: '#000000',

  // RGB channel values
  accentRgb: '34 211 238',
  amberRgb: '251 191 36',
  redRgb: '248 113 113',
  dimRgb: '42 42 42',
}
