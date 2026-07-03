import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ThemeName } from '../config/theme-tokens.js'
import { getReupDirectory } from './project/claude-paths.js'

export interface UserPrefs {
  theme: ThemeName
}

const DEFAULT_PREFS: UserPrefs = {
  theme: 'dark',
}

const VALID_THEME_NAMES = new Set<ThemeName>(['dark', 'light', 'terminal'])

export const PREF_SPECS: Record<keyof UserPrefs, { description: string; values: string[] }> = {
  theme: {
    description: 'Color theme for TUI and web UI',
    values: ['dark', 'light', 'terminal'],
  },
}

function prefsPath(): string {
  return join(getReupDirectory(), 'prefs.json')
}

export function readUserPrefsSync(): UserPrefs {
  try {
    const raw = readFileSync(prefsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      theme: isThemeName(parsed['theme']) ? parsed['theme'] : DEFAULT_PREFS.theme,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && VALID_THEME_NAMES.has(value as ThemeName)
}

export async function readUserPrefs(): Promise<UserPrefs> {
  return readUserPrefsSync()
}

export function writeUserPrefsSync(prefs: UserPrefs): void {
  mkdirSync(getReupDirectory(), { recursive: true })
  writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2) + '\n', 'utf8')
}

export async function writeUserPrefs(prefs: UserPrefs): Promise<void> {
  writeUserPrefsSync(prefs)
}

export async function setUserPref<K extends keyof UserPrefs>(
  key: K,
  value: UserPrefs[K]
): Promise<void> {
  writeUserPrefsSync({ ...readUserPrefsSync(), [key]: value })
}

export async function resetUserPrefs(key?: keyof UserPrefs): Promise<void> {
  if (!key) {
    writeUserPrefsSync({ ...DEFAULT_PREFS })
    return
  }
  writeUserPrefsSync({ ...readUserPrefsSync(), [key]: DEFAULT_PREFS[key] })
}
