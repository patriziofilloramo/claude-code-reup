import { createHash, randomUUID } from 'node:crypto'
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'

import { getReupDirectory } from '../project/claude-paths.js'
import type { SessionWorkState } from './active-sessions.js'
import { isValidSessionId } from './session-model.js'
import { log } from '../../utils/logger.js'

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

// -----------------------------------------------------------------------------
// Work-signal markers (UserPromptSubmit / Stop hooks)
// -----------------------------------------------------------------------------

/**
 * A turn boundary captured from Claude Code's UserPromptSubmit / Stop hooks.
 * These fire for every session regardless of entrypoint, so they provide the
 * busy/idle signal that lock files omit for VS Code peers and fresh processes.
 */
export interface WorkSignalMarker {
  occurredAt: string
  schemaVersion: typeof ATTENTION_SCHEMA_VERSION
  sessionId: string
  state: SessionWorkState
}

const WORK_SIGNAL_HOOK_STATES: Record<string, SessionWorkState> = {
  Stop: 'idle',
  UserPromptSubmit: 'busy',
}

/** Maps a UserPromptSubmit/Stop hook payload to a work marker, or null. */
export function parseWorkSignalHookPayload(
  payload: unknown,
  occurredAt = new Date().toISOString()
): WorkSignalMarker | null {
  if (!isRecord(payload)) return null
  const state = WORK_SIGNAL_HOOK_STATES[String(payload['hook_event_name'])]
  if (!state) return null
  const sessionId = payload['session_id']
  if (typeof sessionId !== 'string' || !isValidSessionId(sessionId)) return null
  return { occurredAt, schemaVersion: ATTENTION_SCHEMA_VERSION, sessionId, state }
}

/** Atomically stores one work marker per session; newer turns replace older ones. */
export async function writeWorkSignalMarker(marker: WorkSignalMarker): Promise<void> {
  const directory = getWorkSignalDirectory()
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

/** Reads every stored work marker; malformed files are skipped, never fatal. */
export async function readWorkSignalMarkers(): Promise<WorkSignalMarker[]> {
  let fileNames: string[]
  try {
    fileNames = await readdir(getWorkSignalDirectory())
  } catch {
    return []
  }

  const markers = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith('.json'))
      .map(async (fileName) => {
        try {
          const parsed = JSON.parse(
            await readFile(join(getWorkSignalDirectory(), fileName), 'utf8')
          )
          return isWorkSignalMarker(parsed) ? parsed : null
        } catch {
          return null
        }
      })
  )
  return markers.filter((marker): marker is WorkSignalMarker => marker !== null)
}

/** Removes one session's work marker (dead-session cleanup). Best-effort. */
export async function clearWorkSignalMarker(sessionId: string): Promise<void> {
  await unlink(join(getWorkSignalDirectory(), `${stableSessionKey(sessionId)}.json`)).catch(
    () => {}
  )
}

/** Removes every stored work marker (used by `reup attention remove`). */
export async function clearAllWorkSignalMarkers(): Promise<void> {
  await rm(getWorkSignalDirectory(), { force: true, recursive: true })
}

/**
 * Merges the lock-file status with the hook-captured work marker: whichever
 * carries the newer transition wins. Locks and markers cover each other's
 * blind spots — locks exist without hooks installed, markers exist for
 * sessions whose locks omit the status field entirely.
 */
export function combineWorkEvidence(
  lockStatus: SessionWorkState | null,
  lockStatusUpdatedAt: number | null,
  marker: WorkSignalMarker | undefined
): { status: SessionWorkState | null; statusUpdatedAt: number | null } {
  const markerMs = marker ? Date.parse(marker.occurredAt) : Number.NaN
  const hasMarker = marker !== undefined && Number.isFinite(markerMs)
  if (!hasMarker) return { status: lockStatus, statusUpdatedAt: lockStatusUpdatedAt }
  if (lockStatus === null || (lockStatusUpdatedAt ?? 0) <= markerMs) {
    return { status: marker.state, statusUpdatedAt: markerMs }
  }
  return { status: lockStatus, statusUpdatedAt: lockStatusUpdatedAt }
}

function isWorkSignalMarker(value: unknown): value is WorkSignalMarker {
  return (
    isRecord(value) &&
    value['schemaVersion'] === ATTENTION_SCHEMA_VERSION &&
    typeof value['sessionId'] === 'string' &&
    isValidSessionId(value['sessionId']) &&
    (value['state'] === 'busy' || value['state'] === 'idle') &&
    typeof value['occurredAt'] === 'string' &&
    Number.isFinite(Date.parse(value['occurredAt']))
  )
}

function getWorkSignalDirectory(): string {
  return join(getReupDirectory(), 'activity')
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

// =============================================================================
// Hook capture logging (always-on diagnostics)
// =============================================================================

export type HookCaptureOutcome =
  | 'work-marker-written'
  | 'attention-marker-written'
  | 'attention-marker-cleared'
  | 'ignored-tty'
  | 'parse-failed'
  | 'unrecognized-payload'
  | 'capture-failed'

export interface HookCaptureResult {
  hookEvent: string | null
  /**
   * When the captured boundary happened, for callers that must recognise it
   * again later — the delayed turn-end check compares it against the session's
   * marker to tell "still the same turn" from "a newer one replaced it".
   * Null for outcomes that record no boundary.
   */
  occurredAt: string | null
  outcome: HookCaptureOutcome
  sessionId: string | null
}

export interface HookCaptureLogEntry extends HookCaptureResult {
  at: string
}

/**
 * Applies one raw hook payload (the exact stdin bytes Claude Code pipes to
 * `reup attention capture`) to the marker store and reports what happened.
 * This is the single capture code path: the CLI adds only stdin plumbing and
 * logging around it, so tests exercising this function exercise production.
 */
export async function applyHookPayload(rawPayload: string): Promise<HookCaptureResult> {
  // Windows shells may prepend a byte-order mark that JSON.parse rejects.
  const text = rawPayload.charCodeAt(0) === 0xfeff ? rawPayload.slice(1) : rawPayload
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return { hookEvent: null, occurredAt: null, outcome: 'parse-failed', sessionId: null }
  }
  if (!isRecord(payload)) {
    return { hookEvent: null, occurredAt: null, outcome: 'unrecognized-payload', sessionId: null }
  }
  const hookEvent =
    typeof payload['hook_event_name'] === 'string' ? payload['hook_event_name'] : null

  // One capture endpoint serves every registered hook event: turn boundaries
  // (UserPromptSubmit/Stop) become work markers, everything else is treated
  // as a needs-input notification.
  const workSignal = parseWorkSignalHookPayload(payload)
  if (workSignal) {
    await writeWorkSignalMarker(workSignal)
    // A submitted prompt means the user responded; the alert is over.
    if (workSignal.state === 'busy') {
      await clearAttentionMarker(workSignal.sessionId)
      return {
        hookEvent,
        occurredAt: workSignal.occurredAt,
        outcome: 'attention-marker-cleared',
        sessionId: workSignal.sessionId,
      }
    }
    return {
      hookEvent,
      occurredAt: workSignal.occurredAt,
      outcome: 'work-marker-written',
      sessionId: workSignal.sessionId,
    }
  }

  const attention = parseNotificationHookPayload(payload)
  if (attention) {
    await writeAttentionMarker(attention)
    return {
      hookEvent,
      occurredAt: attention.occurredAt,
      outcome: 'attention-marker-written',
      sessionId: attention.sessionId,
    }
  }

  return { hookEvent, occurredAt: null, outcome: 'unrecognized-payload', sessionId: null }
}

/** The capture log is halved once it crosses this size, keeping the newest entries. */
const CAPTURE_LOG_MAX_BYTES = 1024 * 1024

export function getHookCaptureLogPath(): string {
  return join(getReupDirectory(), 'attention-capture.log')
}

/** Append one log entry per hook invocation for diagnostics (always-on, not gated by REUP_DEBUG). */
export async function logHookCapture(entry: HookCaptureLogEntry): Promise<void> {
  try {
    const logPath = getHookCaptureLogPath()
    await mkdir(getReupDirectory(), { recursive: true })
    await appendFile(logPath, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 })
    await truncateLogIfNeeded(logPath, CAPTURE_LOG_MAX_BYTES)
  } catch (error) {
    // Log failure must never disrupt Claude Code; keep it inspectable if needed.
    log.debug('hook capture log failed:', error)
  }
}

async function truncateLogIfNeeded(filePath: string, maxSizeBytes: number): Promise<void> {
  try {
    if ((await stat(filePath)).size <= maxSizeBytes) return
    const lines = (await readFile(filePath, 'utf8')).split('\n')
    const trimmed = lines.slice(Math.floor(lines.length / 2)).join('\n')
    const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(tmpPath, trimmed, { encoding: 'utf8', mode: 0o600 })
    await rename(tmpPath, filePath)
  } catch {
    // Truncation is best-effort; a concurrent hook may have already rotated it.
  }
}
