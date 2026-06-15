import type { ThemeTokens } from '../theme-tokens.js'

export const lightTheme: ThemeTokens = {
  name: 'light',

  // Brand colours
  bg: '#f5f5f5',
  surface: '#ffffff',
  dim: '#e0e0e0',
  muted: '#b0b0b0',
  muted2: '#888888',
  text: '#333333',
  strong: '#111111',
  accent: '#0891b2',    // cyan-600 — legible on white
  green: '#059669',     // emerald-600
  amber: '#d97706',     // amber-600
  orange: '#ea580c',    // orange-600
  red: '#dc2626',       // red-600

  // Surface layers
  surfaceRaised: '#ffffff',
  surfaceDeep: '#f0f0f0',
  overlay: 'rgba(0, 0, 0, 0.40)',
  shadowDlg: '0 8px 40px rgba(0, 0, 0, 0.15)',

  // Interaction tints (black-based, inverted from dark theme)
  rowHover: 'rgba(0, 0, 0, 0.04)',
  rowHoverSm: 'rgba(0, 0, 0, 0.02)',
  surfaceChip: 'rgba(0, 0, 0, 0.05)',
  surfaceBtn: 'rgba(0, 0, 0, 0.07)',
  surfaceBtnHover: 'rgba(0, 0, 0, 0.12)',

  // Accent-derived
  accentD: 'rgb(8 145 178 / 0.08)',
  accentHi: '#06b6d4',   // cyan-500
  accentFg: '#ffffff',

  // RGB channel values
  accentRgb: '8 145 178',
  amberRgb: '217 119 6',
  redRgb: '220 38 38',
  dimRgb: '224 224 224',
}
