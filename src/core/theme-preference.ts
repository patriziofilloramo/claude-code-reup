import type { ThemeName } from '../config/theme-tokens.js'
import { readUserPrefsSync, setUserPref } from './user-prefs.js'

/** Returns the persisted theme name from the user-prefs file. */
export function getStoredThemeName(): ThemeName {
  return readUserPrefsSync().theme
}

/** Persists the theme name to the user-prefs file. */
export async function saveThemeName(name: ThemeName): Promise<void> {
  await setUserPref('theme', name)
}
