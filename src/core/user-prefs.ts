import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ThemeName } from '../config/theme-tokens.js'
import { getCcmDirectory } from './claude-paths.js'

export type AutoCleanup = 'off' | 'on' | 'auto'

export interface UserPrefs {
  theme: ThemeName
  autoCleanupOnStart: AutoCleanup
}

const DEFAULT_PREFS: UserPrefs = {
  theme: 'dark',
  autoCleanupOnStart: 'off',
}

export const PREF_SPECS: Record<keyof UserPrefs, { description: string; values: string[] }> = {
  theme: {
    description: 'Color theme for TUI and web UI',
    values: ['dark', 'light', 'terminal'],
  },
  autoCleanupOnStart: {
    description: 'Cleanup mode on startup: off=disabled, on=show picker, auto=silent archive',
    values: ['off', 'on', 'auto'],
  },
}

function prefsPath(): string {
  return join(getCcmDirectory(), 'prefs.json')
}

export function readUserPrefsSync(): UserPrefs {
  try {
    const raw = readFileSync(prefsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<UserPrefs> & {
      autoCleanupOnStart?: AutoCleanup | boolean
    }
    // Migrate old boolean autoCleanupOnStart → 'on' / 'off'
    if (typeof parsed['autoCleanupOnStart'] === 'boolean') {
      parsed['autoCleanupOnStart'] = parsed['autoCleanupOnStart'] ? 'on' : 'off'
    }
    return { ...DEFAULT_PREFS, ...parsed } as UserPrefs
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export async function readUserPrefs(): Promise<UserPrefs> {
  return readUserPrefsSync()
}

export function writeUserPrefsSync(prefs: UserPrefs): void {
  mkdirSync(getCcmDirectory(), { recursive: true })
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
