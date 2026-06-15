import type { ThemeName, ThemeTokens } from '../theme-tokens.js'
import { darkTheme } from './dark.js'
import { lightTheme } from './light.js'
import { terminalTheme } from './terminal.js'

export { darkTheme } from './dark.js'
export { lightTheme } from './light.js'
export { terminalTheme } from './terminal.js'

export const THEMES: Record<ThemeName, ThemeTokens> = {
  dark: darkTheme,
  light: lightTheme,
  terminal: terminalTheme,
}

export const DEFAULT_THEME: ThemeName = 'dark'

export function resolveTheme(name: string | undefined): ThemeTokens {
  if (name && name in THEMES) return THEMES[name as ThemeName]
  return darkTheme
}
