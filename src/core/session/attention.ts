import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getReupDirectory } from '../project/claude-paths.js'
import { isValidSessionId } from './session-model.js'

/** Bump when the marker JSON shape changes in a backwards-incompatible way. */
const ATTENTION_SCHEMA_VERSION = 1

/**
 * One "this session needs the user" fact, captured from Claude Code's
 * Notification hook. Claude Code fires that hook when a session is waiting on
 * a permission decision or has sat idle waiting for input.
 */
export interface AttentionMarker {
  message: string
  occurredAt: string
  schemaVersion: typeof ATTENTION_SCHEMA_VERSION
  sessionId: string
}

export interface AttentionEvidence {
  /** True when a live Claude Code process still holds a lock for the session. */
  isLive: boolean
  /** Last transcript event or file activity (ms epoch), if known. */
  lastActivityMs: number | null
  /** Last lock status transition (ms epoch), if known. */
  statusUpdatedAt: number | null
}

/**
 * Parses the Notification hook's stdin payload into a marker. Hook payloads
 * cross a process boundary, so every field is validated at runtime; unknown
 * fields are ignored so newer Claude Code versions keep working.
 */
export function parseNotificationHookPayload(
  payload: unknown,
  occurredAt = new Date().toISOString()
): AttentionMarker | null {
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload.replace(/^\uFEFF/, ''))
    } catch {
      return null
    }
  }
  if (!isRecord(payload)) return null

  const sessionId = payload['session_id']
  if (typeof sessionId !== 'string' || !isValidSessionId(sessionId)) return null

  const message = typeof payload['message'] === 'string' ? payload['message'].trim() : ''
  return {
    message: message || 'Claude Code is waiting for your input',
    occurredAt,
    schemaVersion: ATTENTION_SCHEMA_VERSION,
    sessionId,
  }
}

/** Atomically stores one marker per session; a newer event replaces the older one. */
export async function writeAttentionMarker(marker: AttentionMarker): Promise<void> {
  const directory = getAttentionDirectory()
  await mkdir(directory, { recursive: true })
  const markerPath = join(directory, `${stableSessionKey(marker.sessionId)}.json`)
  const temporaryPath = `${markerPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(marker), { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, markerPath)
  } finally {
    await unlink(temporaryPath).catch(() => {})
  }
}

/** Reads every stored marker; malformed files are skipped, never fatal. */
export async function readAttentionMarkers(): Promise<AttentionMarker[]> {
  let fileNames: string[]
  try {
    fileNames = await readdir(getAttentionDirectory())
  } catch {
    return []
  }

  const markers = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith('.json'))
      .map(async (fileName) => {
        try {
          const parsed = JSON.parse(await readFile(join(getAttentionDirectory(), fileName), 'utf8'))
          return isAttentionMarker(parsed) ? parsed : null
        } catch {
          return null
        }
      })
  )
  return markers.filter((marker): marker is AttentionMarker => marker !== null)
}

/**
 * True while the user still has not responded. A marker resolves itself as
 * soon as the session shows any life after the event — a busy transition or a
 * new transcript event means the user answered (or the session moved on) —
 * and a dead session cannot be waiting for anyone.
 */
export function isAttentionActive(marker: AttentionMarker, evidence: AttentionEvidence): boolean {
  if (!evidence.isLive) return false
  const occurredMs = Date.parse(marker.occurredAt)
  if (!Number.isFinite(occurredMs)) return false
  if (evidence.statusUpdatedAt !== null && evidence.statusUpdatedAt > occurredMs) return false
  if (evidence.lastActivityMs !== null && evidence.lastActivityMs > occurredMs) return false
  return true
}

/** Removes one session's marker after it resolved. Best-effort by design. */
export async function clearAttentionMarker(sessionId: string): Promise<void> {
  await unlink(join(getAttentionDirectory(), `${stableSessionKey(sessionId)}.json`)).catch(() => {})
}

/** Removes every stored marker (used by `reup attention off`). */
export async function clearAllAttentionMarkers(): Promise<void> {
  await rm(getAttentionDirectory(), { force: true, recursive: true })
}

function isAttentionMarker(value: unknown): value is AttentionMarker {
  return (
    isRecord(value) &&
    value['schemaVersion'] === ATTENTION_SCHEMA_VERSION &&
    typeof value['sessionId'] === 'string' &&
    isValidSessionId(value['sessionId']) &&
    typeof value['message'] === 'string' &&
    typeof value['occurredAt'] === 'string' &&
    Number.isFinite(Date.parse(value['occurredAt']))
  )
}

function stableSessionKey(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex')
}

function getAttentionDirectory(): string {
  return join(getReupDirectory(), 'attention')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
