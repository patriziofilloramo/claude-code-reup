/**
 * TUI design tokens — derived from the active ThemeTokens object.
 *
 * Components import COLORS and SIZES as before; the active theme is determined
 * at startup via getActiveTheme() in src/config/themes/index.ts.
 * CSS equivalents live in src/web/styles.css as :root custom properties,
 * injected at serve time by the web server using themeToCssVars().
 */
import { getStoredThemeName } from '../core/theme-preference.js'
import { APP } from './app.js'
import { resolveTheme } from './themes/index.js'
import type { ThemeTokens } from './theme-tokens.js'

/** Returns COLORS shaped for Ink/React components from a ThemeTokens object. */
export function colorsFromTheme(t: ThemeTokens) {
  return {
    accent: t.accent,
    border: t.dim,
    danger: t.red,
    dim: t.muted,
    muted: t.muted2,
    ok: t.green,
    orange: t.orange,
    text: t.strong,
    textSub: t.text,
    warn: t.amber,
  } as const
}

export const COLORS = colorsFromTheme(
  resolveTheme(
    process.env[APP.themeEnvVar] ?? process.env[APP.legacyThemeEnvVar] ?? getStoredThemeName()
  )
)

export const SIZES = {
  projectPanelWidth: 30,
  projectPanelBreakpoints: [
    { minTerminalWidth: 0, projectPanelWidth: 26 },
    { minTerminalWidth: 100, projectPanelWidth: 30 },
    { minTerminalWidth: 140, projectPanelWidth: 34 },
    { minTerminalWidth: 180, projectPanelWidth: 38 },
    { minTerminalWidth: 240, projectPanelWidth: 42 },
    { minTerminalWidth: 300, projectPanelWidth: 56, showProjectGroups: true },
  ],
  maxProjectPanelWidth: 80,
  projectGroupMinTerminalWidth: 300,
  sessionDetailsMinWidth: 72,
  wideProjectPanelWidth: 52,
} as const
