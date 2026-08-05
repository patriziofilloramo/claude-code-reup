import { execFile } from 'node:child_process'

import { APP } from '../../config/app.js'
import { log } from '../../utils/logger.js'
import { isValidSessionId } from './session-model.js'

/** Values documented for the `waitingFor` field of `claude agents --json`. */
export type ClaudeAgentWaitingFor =
  | 'permission prompt'
  | 'input needed'
  | 'sandbox request'
  | 'worker request'
  | 'dialog open'

export type ClaudeAgentKind = 'interactive' | 'background'
export type ClaudeAgentTaskState = 'working' | 'blocked' | 'done' | 'failed' | 'stopped'
export type ClaudeAgentReportedLiveState = 'needs-input' | 'working' | 'attached' | 'detached'

/**
 * The validated, session-addressable subset of one official inventory row.
 * Display names and summaries are intentionally discarded at the process
 * boundary: live-state resolution has no reason to retain their contents.
 */
export interface ClaudeAgentSessionRecord {
  cwd: string
  kind: ClaudeAgentKind
  /** Present only while Agent View reports an underlying live process. */
  pid: number | null
  reportedLiveState: ClaudeAgentReportedLiveState | null
  /** First observation of the current reported state/reason transition. */
  reportedStateSince: number | null
  sessionId: string
  startedAt: number
  state: ClaudeAgentTaskState | null
  waitingFor: ClaudeAgentWaitingFor | null
}

export interface ClaudeAgentSnapshot {
  observedAt: number
  records: ReadonlyMap<string, ClaudeAgentSessionRecord>
  source: 'claude-agents'
}

export interface ClaudeAgentPresentationAnchors {
  hasLiveLock: boolean
  hasResumeVisibleSession: boolean
}

/**
 * A state candidate keeps its official provenance even after it becomes too
 * old to apply. Consumers may retain a stale record to block destructive
 * actions, but `isFresh === false` must never drive a live-state claim.
 */
export interface ClaudeAgentLiveReading {
  isFresh: boolean
  isSuperseded: boolean
  observedAt: number
  source: 'claude-agents'
  state: ClaudeAgentReportedLiveState
  /** Stable across refreshes while the same state and wait reason persist. */
  stateSince: number
  waitingFor: ClaudeAgentWaitingFor | null
}

/** True only when the official candidate is allowed to drive presentation. */
export function isApplicableClaudeAgentReading(reading: ClaudeAgentLiveReading | null): boolean {
  return reading !== null && reading.isFresh && !reading.isSuperseded
}

export type ClaudeAgentRefreshMode = 'cached' | 'background' | 'wait'

export interface ClaudeAgentSnapshotReader {
  read(mode?: ClaudeAgentRefreshMode): Promise<ClaudeAgentSnapshot | null>
}

type ClaudeAgentsCommand = () => Promise<string>

const WAITING_FOR_VALUES = new Set<ClaudeAgentWaitingFor>([
  'permission prompt',
  'input needed',
  'sandbox request',
  'worker request',
  'dialog open',
])

const TASK_STATES = new Set<ClaudeAgentTaskState>([
  'working',
  'blocked',
  'done',
  'failed',
  'stopped',
])

/**
 * Executes the optional official inventory command without a shell. Fixed
 * argv, timeout, and output bounds make the process boundary independent of
 * session names, paths, and other untrusted values returned by Claude Code.
 */
export function runClaudeAgentsJsonCommand(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'claude',
      ['agents', '--json'],
      {
        encoding: 'utf8',
        maxBuffer: APP.claudeAgentsMaxOutputBytes,
        shell: false,
        timeout: APP.claudeAgentsCommandTimeoutMs,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolve(stdout)
      }
    )
  })
}

/**
 * Parses one complete command response. A malformed envelope rejects the
 * snapshot; malformed or non-addressable rows are isolated and skipped so one
 * future/partial record cannot poison otherwise applicable official evidence.
 */
export function parseClaudeAgentSnapshot(
  output: string,
  observedAt: number
): ClaudeAgentSnapshot | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripBom(output))
  } catch {
    return null
  }

  if (!Array.isArray(parsed) || parsed.length > APP.claudeAgentsMaxRecords) return null

  const records = new Map<string, ClaudeAgentSessionRecord>()
  const duplicateSessionIds = new Set<string>()
  for (const value of parsed) {
    const record = parseClaudeAgentRecord(value, observedAt)
    if (record === null || duplicateSessionIds.has(record.sessionId)) continue
    if (records.has(record.sessionId)) {
      records.delete(record.sessionId)
      duplicateSessionIds.add(record.sessionId)
      continue
    }
    records.set(record.sessionId, record)
  }

  return { observedAt, records, source: 'claude-agents' }
}

/**
 * Resolves the official candidate for one session without discarding stale or
 * superseded provenance. The shared resolver applies it only when both flags
 * allow that claim.
 */
export function claudeAgentLiveReading(
  snapshot: ClaudeAgentSnapshot | null,
  sessionId: string,
  latestLocalReportedAt: number | null,
  hasLiveLock = false,
  now = Date.now()
): ClaudeAgentLiveReading | null {
  const record = snapshot?.records.get(sessionId)
  if (snapshot === null || record?.reportedLiveState === null || record === undefined) return null
  const snapshotAge = now - snapshot.observedAt

  return {
    isFresh: snapshotAge >= 0 && snapshotAge <= APP.claudeAgentsStateFreshMs,
    isSuperseded:
      (latestLocalReportedAt !== null && latestLocalReportedAt > snapshot.observedAt) ||
      (record.reportedLiveState === 'detached' && hasLiveLock),
    observedAt: snapshot.observedAt,
    source: 'claude-agents',
    state: record.reportedLiveState,
    stateSince: record.reportedStateSince ?? snapshot.observedAt,
    waitingFor: record.waitingFor,
  }
}

/**
 * IDs that the official snapshot still protects as active or managed.
 *
 * Agent View deliberately keeps background tasks reported as `working` or
 * `blocked` even after their process exits. Those rows remain actionable in
 * Agent View and must continue to protect the underlying session; `pid` only
 * distinguishes whether a process is currently alive.
 */
export function activeClaudeAgentSessionIds(
  snapshot: ClaudeAgentSnapshot | null,
  now = Date.now(),
  includeRetainedStaleRecords = false
): Set<string> {
  if (snapshot === null) return new Set()
  const maximumAge = includeRetainedStaleRecords
    ? APP.claudeAgentsSafetyRetentionMs
    : APP.claudeAgentsStateFreshMs
  const snapshotAge = now - snapshot.observedAt
  if (snapshotAge < 0 || snapshotAge > maximumAge) return new Set()

  const sessionIds = new Set<string>()
  for (const record of snapshot.records.values()) {
    if (
      record.pid !== null ||
      record.reportedLiveState === 'working' ||
      record.reportedLiveState === 'needs-input' ||
      record.reportedLiveState === 'attached'
    ) {
      sessionIds.add(record.sessionId)
    }
  }
  return sessionIds
}

/**
 * Whether Reup can responsibly surface an official inventory row as local
 * live activity. A pidless Agent View background task is still valid managed
 * state, but an official-only row with neither a resume-visible session nor a
 * verified live lock cannot produce a navigable session card. Hook markers do
 * not count because they can outlive the session. This presentation rule must
 * never be used to weaken deletion or resume safety checks.
 */
export function isPresentableClaudeAgentSession(
  record: ClaudeAgentSessionRecord | undefined,
  anchors: ClaudeAgentPresentationAnchors
): boolean {
  return (
    (record !== undefined && record.pid !== null) ||
    anchors.hasLiveLock ||
    anchors.hasResumeVisibleSession
  )
}

/**
 * Builds an isolated stale-while-revalidate reader. Production shares one
 * instance; tests inject a deterministic command and clock without touching a
 * user's Claude installation.
 */
export function createClaudeAgentSnapshotReader(
  executeCommand: ClaudeAgentsCommand,
  now: () => number = Date.now
): ClaudeAgentSnapshotReader {
  let lastSuccessfulSnapshot: ClaudeAgentSnapshot | null = null
  let nextRefreshAt = 0
  let refreshInFlight: Promise<void> | null = null

  const refresh = (): Promise<void> => {
    if (refreshInFlight !== null) return refreshInFlight
    nextRefreshAt = now() + APP.claudeAgentsRefreshMs
    refreshInFlight = (async () => {
      try {
        const output = await executeCommand()
        const snapshot = parseClaudeAgentSnapshot(output, now())
        if (snapshot === null) throw new Error('invalid claude agents JSON schema')
        lastSuccessfulSnapshot = preserveReportedStateTransitions(snapshot, lastSuccessfulSnapshot)
      } catch (error) {
        log.debug('claude agents inventory unavailable:', sanitizedProcessError(error))
      } finally {
        refreshInFlight = null
      }
    })()
    return refreshInFlight
  }

  const retainedSnapshot = (): ClaudeAgentSnapshot | null => {
    if (
      lastSuccessfulSnapshot !== null &&
      now() - lastSuccessfulSnapshot.observedAt <= APP.claudeAgentsSafetyRetentionMs
    ) {
      return lastSuccessfulSnapshot
    }
    return null
  }

  return {
    async read(mode = 'background'): Promise<ClaudeAgentSnapshot | null> {
      const due = now() >= nextRefreshAt
      if (mode !== 'cached' && due) {
        const pendingRefresh = refresh()
        if (mode === 'wait') await pendingRefresh
      } else if (mode === 'wait' && refreshInFlight !== null) {
        await refreshInFlight
      }
      return retainedSnapshot()
    },
  }
}

const productionReader = createClaudeAgentSnapshotReader(runClaudeAgentsJsonCommand)

/** Reads the shared production cache, falling back to null when disabled. */
export async function readClaudeAgentSnapshot(
  mode: ClaudeAgentRefreshMode = 'background'
): Promise<ClaudeAgentSnapshot | null> {
  if (process.env[APP.disableClaudeAgentsEnvVar]) return null
  return productionReader.read(mode)
}

function parseClaudeAgentRecord(
  value: unknown,
  observedAt: number
): ClaudeAgentSessionRecord | null {
  if (!isObject(value)) return null

  const cwd = value['cwd']
  const kind = value['kind']
  const startedAt = value['startedAt']
  const sessionId = value['sessionId']
  if (
    typeof cwd !== 'string' ||
    (kind !== 'interactive' && kind !== 'background') ||
    !isNonNegativeSafeInteger(startedAt) ||
    typeof sessionId !== 'string' ||
    !isValidSessionId(sessionId)
  ) {
    return null
  }

  if (!optionalString(value['id']) || !optionalString(value['name'])) return null

  const pidValue = value['pid']
  if (pidValue !== undefined && !isPositiveSafeInteger(pidValue)) return null

  const stateValue = value['state']
  if (kind === 'background' && !isTaskState(stateValue)) return null
  if (stateValue !== undefined && !isTaskState(stateValue)) return null
  const state = stateValue ?? null

  const statusValue = value['status']
  if (statusValue !== undefined && (typeof statusValue !== 'string' || statusValue.length > 64)) {
    return null
  }

  const waitingForValue = value['waitingFor']
  if (
    waitingForValue !== undefined &&
    (typeof waitingForValue !== 'string' || waitingForValue.length > 128)
  ) {
    return null
  }
  const waitingFor = isWaitingFor(waitingForValue) ? waitingForValue : null
  const pid = pidValue ?? null

  const liveState = reportedLiveState(state, statusValue, pid)
  return {
    cwd,
    kind,
    pid,
    reportedLiveState: liveState,
    reportedStateSince: liveState === null ? null : observedAt,
    sessionId,
    startedAt,
    state,
    // A documented reason applies to a blocked task or a waiting process. An
    // out-of-context value is retained as no reason, never promoted to a claim.
    waitingFor: state === 'blocked' || statusValue === 'waiting' ? waitingFor : null,
  }
}

function preserveReportedStateTransitions(
  next: ClaudeAgentSnapshot,
  previous: ClaudeAgentSnapshot | null
): ClaudeAgentSnapshot {
  if (previous === null) return next
  const observationGap = next.observedAt - previous.observedAt
  if (observationGap < 0 || observationGap > APP.claudeAgentsSafetyRetentionMs) return next

  const records = new Map<string, ClaudeAgentSessionRecord>()
  for (const [sessionId, record] of next.records) {
    const previousRecord = previous.records.get(sessionId)
    const sameTransition =
      previousRecord !== undefined &&
      previousRecord.reportedLiveState === record.reportedLiveState &&
      previousRecord.waitingFor === record.waitingFor
    records.set(
      sessionId,
      sameTransition ? { ...record, reportedStateSince: previousRecord.reportedStateSince } : record
    )
  }
  return { ...next, records }
}

function reportedLiveState(
  state: ClaudeAgentTaskState | null,
  status: unknown,
  pid: number | null
): ClaudeAgentReportedLiveState | null {
  if (state === 'working') return status === 'waiting' ? null : 'working'
  if (state === 'blocked') return 'needs-input'
  if (status === 'waiting') return 'needs-input'
  if (state === 'done' || state === 'failed' || state === 'stopped') {
    return pid === null ? 'detached' : 'attached'
  }
  return null
}

function isTaskState(value: unknown): value is ClaudeAgentTaskState {
  return typeof value === 'string' && TASK_STATES.has(value as ClaudeAgentTaskState)
}

function isWaitingFor(value: unknown): value is ClaudeAgentWaitingFor {
  return typeof value === 'string' && WAITING_FOR_VALUES.has(value as ClaudeAgentWaitingFor)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value > 0
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}

function sanitizedProcessError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error'
  const code = (error as NodeJS.ErrnoException).code
  return code ? `${error.name} (${code})` : error.name
}
