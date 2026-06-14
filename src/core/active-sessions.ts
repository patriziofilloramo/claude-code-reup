import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getClaudeDirectory } from './claude-paths.js'

interface ActiveSessionRecord {
  pid?: unknown
  sessionId?: unknown
}

export interface SessionLockInfo {
  pid: number
  cwd: string | null
  startedAt: string | null
}

/** Returns session IDs currently referenced by a live Claude Code process. */
export async function getActiveSessions(): Promise<Set<string>> {
  const activeSessionIds = new Set<string>()
  const sessionsDirectory = join(getClaudeDirectory(), 'sessions')

  let sessionRecordFileNames: string[]
  try {
    sessionRecordFileNames = await readdir(sessionsDirectory)
  } catch {
    return activeSessionIds
  }

  for (const fileName of sessionRecordFileNames) {
    if (!fileName.endsWith('.json')) continue

    try {
      const sessionRecord = JSON.parse(
        await readFile(join(sessionsDirectory, fileName), 'utf8')
      ) as ActiveSessionRecord
      if (typeof sessionRecord.sessionId !== 'string' || typeof sessionRecord.pid !== 'number') {
        continue
      }

      try {
        process.kill(sessionRecord.pid, 0)
        activeSessionIds.add(sessionRecord.sessionId)
      } catch (error: unknown) {
        // EPERM means the process exists but this user cannot signal it.
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          activeSessionIds.add(sessionRecord.sessionId)
        }
      }
    } catch {
      // Ignore unreadable or malformed process records.
    }
  }

  return activeSessionIds
}

/**
 * Returns lock file details for a specific session if it is currently live.
 * Returns null when the session has no lock file or the process is dead.
 */
export async function getSessionLockInfo(sessionId: string): Promise<SessionLockInfo | null> {
  const sessionsDirectory = join(getClaudeDirectory(), 'sessions')
  let fileNames: string[]
  try {
    fileNames = await readdir(sessionsDirectory)
  } catch {
    return null
  }

  for (const fileName of fileNames) {
    if (!fileName.endsWith('.json')) continue
    try {
      const record = JSON.parse(
        await readFile(join(sessionsDirectory, fileName), 'utf8')
      ) as Record<string, unknown>

      if (record['sessionId'] !== sessionId || typeof record['pid'] !== 'number') continue

      try {
        process.kill(record['pid'], 0)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EPERM') continue
      }

      return {
        pid: record['pid'],
        cwd: typeof record['cwd'] === 'string' ? record['cwd'] : null,
        startedAt: typeof record['startedAt'] === 'string' ? record['startedAt'] : null,
      }
    } catch {
      continue
    }
  }
  return null
}
