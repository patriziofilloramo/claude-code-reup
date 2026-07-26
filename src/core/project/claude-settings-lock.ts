import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { getReupDirectory } from './claude-paths.js'
import { withAdvisoryFileLock } from './project-sidecar-lock.js'

const REUP_SETTINGS_LOCK_FILE = 'claude-settings.json.lock'

/**
 * Serialises Reup's own read-modify-write operations on Claude's settings.
 *
 * This is deliberately a Reup-owned lock: it coordinates Reup processes and
 * integrations without claiming that Claude Code or other settings editors
 * participate in the same protocol.
 */
export async function withReupSettingsLock<T>(operation: () => Promise<T>): Promise<T> {
  const reupDirectory = getReupDirectory()
  await mkdir(reupDirectory, { mode: 0o700, recursive: true })
  await chmod(reupDirectory, 0o700).catch(() => {})
  return withAdvisoryFileLock(join(reupDirectory, REUP_SETTINGS_LOCK_FILE), operation)
}
