/**
 * Unified design-token schema for Reup themes.
 *
 * ThemeTokens covers every value used by either the TUI (Ink/React) or the
 * web UI (CSS custom properties). A theme is just a plain object that satisfies
 * this interface — no build step required.
 *
 * The web server injects the active theme's CSS variables at serve time so the
 * browser never needs to know about TypeScript. The TUI reads the same objects
 * directly at runtime.
 *
 * Naming mirrors the CSS custom-property names in styles.css (without the --
 * prefix) so the mapping is mechanical and auditable.
 */

export interface ThemeTokens {
  // ── Brand colours ────────────────────────────────────────────────────────
  bg: string
  surface: string
  dim: string
  muted: string
  muted2: string
  text: string
  strong: string
  accent: string
  green: string
  amber: string
  orange: string
  red: string

  // ── Surface layers ────────────────────────────────────────────────────────
  surfaceRaised: string // dialogs, drawer panes
  surfaceDeep: string // toasts, dropdown option backgrounds
  overlay: string // full-screen dim behind modals
  shadowDlg: string // floating panel drop shadow

  // ── Interaction tints ─────────────────────────────────────────────────────
  rowHover: string
  rowHoverSm: string
  surfaceChip: string // tag / badge backgrounds
  surfaceBtn: string // secondary button fill
  surfaceBtnHover: string

  // ── Accent-derived ────────────────────────────────────────────────────────
  accentD: string // subtle accent background tint
  accentHi: string // lighter hover highlight
  accentFg: string // foreground on accent backgrounds

  // ── RGB channel values (for rgba composites without extra tokens) ─────────
  accentRgb: string // e.g. "34 211 238"
  amberRgb: string
  redRgb: string
  dimRgb: string

  // ── Theme metadata ────────────────────────────────────────────────────────
  /** Machine-readable key used in --theme flag and persistence file. */
  name: ThemeName

  /** Scan-line overlay effect; only meaningful for the Terminal theme web UI. */
  scanlineOpacity?: number
}

export type ThemeName = 'dark' | 'light' | 'terminal'

/**
 * Maps ThemeTokens keys to the CSS custom-property names used in styles.css.
 * Allows the web server to inject variables without knowing CSS internals.
 */
export const TOKEN_TO_CSS_VAR: Record<keyof Omit<ThemeTokens, 'name' | 'scanlineOpacity'>, string> =
  {
    bg: '--bg',
    surface: '--surface',
    dim: '--dim',
    muted: '--muted',
    muted2: '--muted2',
    text: '--text',
    strong: '--strong',
    accent: '--accent',
    green: '--green',
    amber: '--amber',
    orange: '--orange',
    red: '--red',
    surfaceRaised: '--surface-raised',
    surfaceDeep: '--surface-deep',
    overlay: '--overlay',
    shadowDlg: '--shadow-dlg',
    rowHover: '--row-hover',
    rowHoverSm: '--row-hover-sm',
    surfaceChip: '--surface-chip',
    surfaceBtn: '--surface-btn',
    surfaceBtnHover: '--surface-btn-hover',
    accentD: '--accent-d',
    accentHi: '--accent-hi',
    accentFg: '--accent-fg',
    accentRgb: '--accent-rgb',
    amberRgb: '--amber-rgb',
    redRgb: '--red-rgb',
    dimRgb: '--dim-rgb',
  }

/** Generates a CSS :root { … } block from a ThemeTokens object. */
export function themeToCssVars(theme: ThemeTokens): string {
  const lines: string[] = [':root {']
  for (const [key, cssVar] of Object.entries(TOKEN_TO_CSS_VAR)) {
    const value = theme[key as keyof typeof TOKEN_TO_CSS_VAR]
    if (value !== undefined) lines.push(`  ${cssVar}: ${value};`)
  }
  if (theme.scanlineOpacity !== undefined) {
    lines.push(`  --scanline-opacity: ${theme.scanlineOpacity};`)
  }
  lines.push('}')
  return lines.join('\n')
}
