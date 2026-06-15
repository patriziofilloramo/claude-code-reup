import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getClaudeDirectory } from './claude-paths.js'

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export interface SessionLockRecord {
  sessionId: string
  pid: number
  cwd: string | null
  startedAt: number | null
}

export interface SessionLockInfo {
  pid: number
  cwd: string | null
  startedAt: string | null
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/** Returns lock-file details for every currently live Claude Code process. */
export async function getLiveSessionRecords(): Promise<SessionLockRecord[]> {
  const sessionsDirectory = join(getClaudeDirectory(), 'sessions')

  let fileNames: string[]
  try {
    fileNames = await readdir(sessionsDirectory)
  } catch {
    return []
  }

  const records = await Promise.all(
    fileNames
      .filter((f) => f.endsWith('.json'))
      .map((f) => parseLockFile(join(sessionsDirectory, f)))
  )

  return records.filter((r): r is SessionLockRecord => r !== null)
}

/** Returns session IDs for every live Claude Code process. */
export async function getActiveSessions(): Promise<Set<string>> {
  const records = await getLiveSessionRecords()
  return new Set(records.map((r) => r.sessionId))
}

/**
 * Returns lock-file details for a specific session if it is currently live.
 * Returns null when the session has no lock file or the process is dead.
 */
export async function getSessionLockInfo(sessionId: string): Promise<SessionLockInfo | null> {
  const records = await getLiveSessionRecords()
  const record = records.find((r) => r.sessionId === sessionId)
  if (!record) return null

  return {
    pid: record.pid,
    cwd: record.cwd,
    startedAt: record.startedAt !== null ? new Date(record.startedAt).toISOString() : null,
  }
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

async function parseLockFile(filePath: string): Promise<SessionLockRecord | null> {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>

    const sessionId = raw['sessionId']
    const pid = raw['pid']
    const cwd = raw['cwd']

    if (typeof sessionId !== 'string' || typeof pid !== 'number') {
      return null
    }

    if (!isProcessAlive(pid)) return null

    return {
      sessionId,
      pid,
      cwd: typeof cwd === 'string' ? cwd : null,
      startedAt: typeof raw['startedAt'] === 'number' ? raw['startedAt'] : null,
    }
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}
