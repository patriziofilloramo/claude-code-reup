import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ThemeName } from '../config/theme-tokens.js'
import { getCcmDirectory } from './claude-paths.js'

const VALID_THEMES = new Set<ThemeName>(['dark', 'light', 'terminal'])
const THEME_FILE = 'theme'

/** Reads the persisted theme name from ~/.claude/ccm/theme, or undefined if unset. */
export function getStoredThemeName(): ThemeName | undefined {
  try {
    const name = readFileSync(join(getCcmDirectory(), THEME_FILE), 'utf8').trim() as ThemeName
    return VALID_THEMES.has(name) ? name : undefined
  } catch {
    return undefined
  }
}

/** Writes the theme name to ~/.claude/ccm/theme, creating the directory if needed. */
export function saveThemeName(name: ThemeName): void {
  mkdirSync(getCcmDirectory(), { recursive: true })
  writeFileSync(join(getCcmDirectory(), THEME_FILE), name, 'utf8')
}
