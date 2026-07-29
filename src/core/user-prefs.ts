import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  const directory = getReupDirectory()
  mkdirSync(directory, { mode: 0o700, recursive: true })
  try {
    chmodSync(directory, 0o700)
  } catch {
    // Some filesystems do not expose POSIX permissions. The creation mode is
    // still applied wherever it is supported.
  }
  writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })
  try {
    // writeFile preserves the mode of an existing file, so repair older prefs
    // files that predate private creation modes.
    chmodSync(prefsPath(), 0o600)
  } catch {
    // Best effort for filesystems without POSIX permission support.
  }
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
