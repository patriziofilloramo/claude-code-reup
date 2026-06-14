import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type Density = 'compact' | 'comfortable'

export interface UserPrefs {
  density: Density
}

const DEFAULT_PREFS: UserPrefs = {
  density: 'compact',
}

export const PREF_SPECS: Record<
  keyof UserPrefs,
  { description: string; values: string[] }
> = {
  density: {
    description: 'Session list spacing in the TUI',
    values: ['compact', 'comfortable'],
  },
}

function prefsPath(): string {
  return join(homedir(), '.ccm', 'prefs.json')
}

export async function readUserPrefs(): Promise<UserPrefs> {
  try {
    const raw = await readFile(prefsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<UserPrefs>
    return { ...DEFAULT_PREFS, ...parsed }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export async function writeUserPrefs(prefs: UserPrefs): Promise<void> {
  const p = prefsPath()
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(prefs, null, 2) + '\n', 'utf8')
}

export async function setUserPref<K extends keyof UserPrefs>(
  key: K,
  value: UserPrefs[K]
): Promise<void> {
  const current = await readUserPrefs()
  await writeUserPrefs({ ...current, [key]: value })
}

export async function resetUserPrefs(key?: keyof UserPrefs): Promise<void> {
  if (!key) {
    await writeUserPrefs({ ...DEFAULT_PREFS })
    return
  }
  const current = await readUserPrefs()
  await writeUserPrefs({ ...current, [key]: DEFAULT_PREFS[key] })
}
