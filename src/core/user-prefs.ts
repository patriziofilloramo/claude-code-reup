import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ThemeName } from '../config/theme-tokens.js'
import { getSwoopDirectory } from './project/claude-paths.js'

export type AutoCleanup = 'off' | 'on' | 'auto'
export type CrossDeviceSessionStorage = 'off' | 'on'

export interface UserPrefs {
  autoCleanupOnStart: AutoCleanup
  crossDeviceSessionStorage: CrossDeviceSessionStorage
  theme: ThemeName
}

const DEFAULT_PREFS: UserPrefs = {
  autoCleanupOnStart: 'off',
  crossDeviceSessionStorage: 'off',
  theme: 'dark',
}

const VALID_AUTO_CLEANUP_VALUES = new Set<AutoCleanup>(['off', 'on', 'auto'])
const VALID_CROSS_DEVICE_STORAGE_VALUES = new Set<CrossDeviceSessionStorage>(['off', 'on'])
const VALID_THEME_NAMES = new Set<ThemeName>(['dark', 'light', 'terminal'])

export const PREF_SPECS: Record<keyof UserPrefs, { description: string; values: string[] }> = {
  theme: {
    description: 'Color theme for TUI and web UI',
    values: ['dark', 'light', 'terminal'],
  },
  autoCleanupOnStart: {
    description: 'Cleanup mode on startup: off=disabled, on=show picker, auto=silent archive',
    values: ['off', 'on', 'auto'],
  },
  crossDeviceSessionStorage: {
    description: 'Alpha cross-device Claude session storage sync',
    values: ['off', 'on'],
  },
}

function prefsPath(): string {
  return join(getSwoopDirectory(), 'prefs.json')
}

export function readUserPrefsSync(): UserPrefs {
  try {
    const raw = readFileSync(prefsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    // Migrate old boolean autoCleanupOnStart → 'on' / 'off'
    if (typeof parsed['autoCleanupOnStart'] === 'boolean') {
      parsed['autoCleanupOnStart'] = parsed['autoCleanupOnStart'] ? 'on' : 'off'
    }
    return {
      autoCleanupOnStart: isAutoCleanup(parsed['autoCleanupOnStart'])
        ? parsed['autoCleanupOnStart']
        : DEFAULT_PREFS.autoCleanupOnStart,
      crossDeviceSessionStorage: isCrossDeviceSessionStorage(parsed['crossDeviceSessionStorage'])
        ? parsed['crossDeviceSessionStorage']
        : isCrossDeviceSessionStorage(parsed['experimentalSharedSync'])
          ? parsed['experimentalSharedSync']
          : DEFAULT_PREFS.crossDeviceSessionStorage,
      theme: isThemeName(parsed['theme']) ? parsed['theme'] : DEFAULT_PREFS.theme,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function isAutoCleanup(value: unknown): value is AutoCleanup {
  return typeof value === 'string' && VALID_AUTO_CLEANUP_VALUES.has(value as AutoCleanup)
}

function isCrossDeviceSessionStorage(value: unknown): value is CrossDeviceSessionStorage {
  return (
    typeof value === 'string' &&
    VALID_CROSS_DEVICE_STORAGE_VALUES.has(value as CrossDeviceSessionStorage)
  )
}

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && VALID_THEME_NAMES.has(value as ThemeName)
}

export async function readUserPrefs(): Promise<UserPrefs> {
  return readUserPrefsSync()
}

export function writeUserPrefsSync(prefs: UserPrefs): void {
  mkdirSync(getSwoopDirectory(), { recursive: true })
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
