import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getClaudeDirectory } from '../project/claude-paths.js'
import { isValidSessionId } from './session-model.js'

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

/** Claude Code's own activity flag written into the lock file (v2.1.197+). */
export type SessionLockStatus = 'busy' | 'idle'

export interface SessionLockRecord {
  sessionId: string
  pid: number
  cwd: string | null
  startedAt: number | null
  /** Null when the running Claude Code version predates lock-status support. */
  status: SessionLockStatus | null
  statusUpdatedAt: number | null
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

export interface MergedSessionLockStatus {
  status: SessionLockStatus | null
  /** Freshest transition timestamp among the locks carrying the merged status. */
  statusUpdatedAt: number | null
}

/**
 * A busy flag older than this (ms) is not trusted on its own: Claude Code
 * rewrites the lock only on state transitions, so a session that died or was
 * interrupted mid-turn leaves `busy` behind forever. Callers must corroborate
 * older flags with transcript evidence before reporting work in progress.
 */
export const BUSY_STATUS_TRUST_WINDOW_MS = 5 * 60_000

/**
 * True when a busy flag is backed by recent evidence — a fresh status
 * transition or recent transcript activity, whichever is newer.
 */
export function isBusyEvidenceFresh(
  statusUpdatedAt: number | null,
  lastActivityMs: number | null,
  now = Date.now()
): boolean {
  const latestEvidenceMs = Math.max(statusUpdatedAt ?? 0, lastActivityMs ?? 0)
  return latestEvidenceMs > 0 && now - latestEvidenceMs <= BUSY_STATUS_TRUST_WINDOW_MS
}

/**
 * Collapses lock records to one status per session. A session can hold several
 * locks at once (e.g. a CLI process plus a VS Code peer); any busy lock marks
 * the whole session busy, and a status-less lock never downgrades a known one.
 */
export function mergeSessionLockStatuses(
  records: SessionLockRecord[]
): Map<string, MergedSessionLockStatus> {
  const statusBySession = new Map<string, MergedSessionLockStatus>()
  for (const record of records) {
    const merged = statusBySession.get(record.sessionId) ?? { status: null, statusUpdatedAt: null }
    statusBySession.set(record.sessionId, merged)

    const recordApplies =
      record.status !== null && (record.status === 'busy' || merged.status !== 'busy')
    if (!recordApplies) continue

    if (record.status !== merged.status) {
      merged.status = record.status
      merged.statusUpdatedAt = record.statusUpdatedAt
    } else {
      merged.statusUpdatedAt =
        Math.max(merged.statusUpdatedAt ?? 0, record.statusUpdatedAt ?? 0) || null
    }
  }
  return statusBySession
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

    if (typeof sessionId !== 'string' || !isValidSessionId(sessionId) || typeof pid !== 'number') {
      return null
    }

    if (!isProcessAlive(pid)) return null

    const status = raw['status']
    return {
      sessionId,
      pid,
      cwd: typeof cwd === 'string' ? cwd : null,
      startedAt: typeof raw['startedAt'] === 'number' ? raw['startedAt'] : null,
      status: status === 'busy' || status === 'idle' ? status : null,
      statusUpdatedAt: typeof raw['statusUpdatedAt'] === 'number' ? raw['statusUpdatedAt'] : null,
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
