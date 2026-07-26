import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { APP } from '../../config/app.js'
import { clearAccountUsageCache, readAccountUsage } from './account-usage.js'
import {
  getReupDirectory,
  getClaudeDirectory,
  getClaudeStatePath,
} from '../project/claude-paths.js'

/** Bump when the snapshot JSON shape changes in a backwards-incompatible way. */
const USAGE_SCHEMA_VERSION = 1
/** Filename for the last collector error stored in the Reup directory. */
const CAPTURE_ERROR_FILE_NAME = 'usage-capture-error.json'
/** Filename for the statusline integration marker in the Reup directory. */
const INTEGRATION_FILE_NAME = 'statusline-integration.json'
/** Maximum rename attempts when another process holds a file lock (Windows EACCES/EPERM). */
const MAX_RENAME_RETRIES = 5
/** Base delay (ms) between rename retries; multiplied by attempt number for back-off. */
const RENAME_RETRY_DELAY_MS = 10

/** Serialises snapshots for one session inside this process. */
const snapshotWriteQueues = new Map<string, Promise<void>>()

export interface UsageLimitWindow {
  resetsAt: string | null
  usedPercentage: number
}

export interface LiveUsageSnapshot {
  agentName?: string
  capturedAt: string
  contextRemainingPercentage?: number
  contextUsedPercentage?: number
  contextWindowSize?: number
  modelDisplayName?: string
  modelId?: string
  rateLimits: {
    fiveHour?: UsageLimitWindow
    sevenDay?: UsageLimitWindow
  }
  schemaVersion: typeof USAGE_SCHEMA_VERSION
  sessionId: string
}

export interface LiveUsageSummary {
  captureIssue: string | null
  captureStatus: UsageCaptureStatus
  configured: boolean
  freshness: 'fresh' | 'stale' | 'unavailable'
  limitsIssue: string | null
  limitsSource: 'account-api' | 'status-line' | 'unavailable'
  limitsStatus: 'fresh' | 'stale' | 'unavailable'
  limitsUpdatedAt: string | null
  rateLimits: LiveUsageSnapshot['rateLimits']
  snapshot: LiveUsageSnapshot | null
  updateStrategy: 'account-api-with-status-line-fallback'
  updatedAt: string | null
  usageCreditsEnabled: boolean | null
}

export type UsageCaptureStatus = 'error' | 'live' | 'misconfigured' | 'off' | 'stale' | 'waiting'

interface UsageCaptureError {
  message: string
  occurredAt: string
}

interface UsageCaptureIntegrationState {
  configured: boolean
  issue: string | null
  markerPresent: boolean
}

interface SelectedUsageSnapshot {
  snapshot: LiveUsageSnapshot
}

interface SelectedUsageLimits {
  rateLimits: LiveUsageSnapshot['rateLimits']
  updatedAt: string
}

interface StatusLinePayload {
  agent?: { name?: unknown }
  context_window?: {
    context_window_size?: unknown
    remaining_percentage?: unknown
    used_percentage?: unknown
  }
  model?: { display_name?: unknown; id?: unknown }
  rate_limits?: {
    five_hour?: { resets_at?: unknown; used_percentage?: unknown }
    seven_day?: { resets_at?: unknown; used_percentage?: unknown }
  }
  session_id?: unknown
}

/** Keeps only supported aggregate fields from Claude Code's status-line input. */
export function parseStatusLineUsage(
  payload: unknown,
  capturedAt = new Date().toISOString()
): LiveUsageSnapshot | null {
  const input = parseStatusLinePayload(payload)
  if (!input) return null
  if (typeof input.session_id !== 'string' || input.session_id.length === 0) return null

  const agentName = stringValue(input.agent?.name)
  const contextRemainingPercentage = percentageValue(input.context_window?.remaining_percentage)
  const contextUsedPercentage = percentageValue(input.context_window?.used_percentage)
  const contextWindowSize = nonNegativeNumber(input.context_window?.context_window_size)
  const fiveHour = parseLimitWindow(input.rate_limits?.five_hour)
  const modelDisplayName = stringValue(input.model?.display_name)
  const modelId = stringValue(input.model?.id)
  const sevenDay = parseLimitWindow(input.rate_limits?.seven_day)

  return {
    ...(agentName ? { agentName } : {}),
    capturedAt,
    ...(contextRemainingPercentage !== undefined ? { contextRemainingPercentage } : {}),
    ...(contextUsedPercentage !== undefined ? { contextUsedPercentage } : {}),
    ...(contextWindowSize !== undefined ? { contextWindowSize } : {}),
    ...(modelDisplayName ? { modelDisplayName } : {}),
    ...(modelId ? { modelId } : {}),
    rateLimits: {
      ...(fiveHour ? { fiveHour } : {}),
      ...(sevenDay ? { sevenDay } : {}),
    },
    schemaVersion: USAGE_SCHEMA_VERSION,
    sessionId: input.session_id,
  }
}

/** Atomically stores one session snapshot so concurrent sessions never overwrite each other. */
export async function writeLiveUsageSnapshot(snapshot: LiveUsageSnapshot): Promise<void> {
  const usageDirectory = getUsageDirectory()
  await mkdir(usageDirectory, { recursive: true })

  const snapshotPath = join(usageDirectory, `${stableSessionKey(snapshot.sessionId)}.json`)
  const previousWrite = snapshotWriteQueues.get(snapshotPath) ?? Promise.resolve()
  const queuedWrite = previousWrite.then(() => writeSnapshotAtomically(snapshotPath, snapshot))
  const handledWrite = queuedWrite.catch(() => {})
  snapshotWriteQueues.set(snapshotPath, handledWrite)

  try {
    await queuedWrite
  } finally {
    if (snapshotWriteQueues.get(snapshotPath) === handledWrite) {
      snapshotWriteQueues.delete(snapshotPath)
    }
  }
}

async function writeSnapshotAtomically(
  snapshotPath: string,
  snapshot: LiveUsageSnapshot
): Promise<void> {
  const temporaryPath = `${snapshotPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 })
    await renameWithContentionRetry(temporaryPath, snapshotPath)
  } finally {
    await unlink(temporaryPath).catch(() => {})
  }
}

/** Returns the best available snapshot and its freshness state. */
export async function readLiveUsageSummary(now = Date.now()): Promise<LiveUsageSummary> {
  const [snapshots, integration, captureError, usageCreditsEnabled] = await Promise.all([
    readLiveUsageSnapshots(),
    readUsageCaptureIntegrationState(),
    readUsageCaptureError(),
    readUsageCreditsEnabled(),
  ])
  const accountUsage = await readAccountUsage(now)
  const selection = selectNewestSnapshot(snapshots)
  const snapshot = selection?.snapshot ?? null
  const freshness = snapshot
    ? now - new Date(snapshot.capturedAt).getTime() <= APP.usageStaleMs
      ? 'fresh'
      : 'stale'
    : 'unavailable'
  const captureStatus = determineCaptureStatus(integration, captureError, snapshot, freshness)
  const fallbackLimits = selectNewestLimits(snapshots, now)
  const accountLimits = accountUsage.snapshot
  const shouldExposeAccountIssue = integration.configured || accountUsage.snapshot !== null
  const limitsUpdatedAt = accountLimits?.fetchedAt ?? fallbackLimits?.updatedAt ?? null
  const rateLimits = accountLimits?.rateLimits ?? fallbackLimits?.rateLimits ?? {}
  const limitsSource = accountLimits
    ? 'account-api'
    : fallbackLimits
      ? 'status-line'
      : 'unavailable'
  const limitsStatus = accountLimits
    ? accountUsage.status
    : fallbackLimits
      ? 'stale'
      : 'unavailable'

  return {
    captureIssue:
      integration.issue ??
      (captureStatus === 'error'
        ? (captureError?.message ?? 'usage collector failed')
        : captureStatus === 'stale'
          ? 'No status-line payload was received for one minute. This feed updates only when Claude Code invokes the terminal status line.'
          : null),
    captureStatus,
    configured: integration.configured,
    freshness,
    limitsIssue: shouldExposeAccountIssue ? accountUsage.issue : null,
    limitsSource,
    limitsStatus,
    limitsUpdatedAt,
    rateLimits,
    snapshot,
    updateStrategy: 'account-api-with-status-line-fallback',
    updatedAt: snapshot?.capturedAt ?? null,
    usageCreditsEnabled: accountLimits?.usageCreditsEnabled ?? usageCreditsEnabled,
  }
}

/** Stores one privacy-safe collector error so silent failures remain diagnosable. */
export async function recordUsageCaptureError(error: unknown): Promise<void> {
  await writeJsonAtomically(join(getReupDirectory(), CAPTURE_ERROR_FILE_NAME), {
    message: error instanceof Error ? error.message : String(error),
    occurredAt: new Date().toISOString(),
  } satisfies UsageCaptureError)
}

/** Clears an earlier collector error after the next successful capture. */
export async function clearUsageCaptureError(): Promise<void> {
  await unlink(join(getReupDirectory(), CAPTURE_ERROR_FILE_NAME)).catch(() => {})
}

/**
 * Reads Claude Code's best-effort cached usage-credit flag.
 *
 * This local application-state field is not a documented API, so absence,
 * structural changes, and read errors remain unknown rather than false.
 */
async function readUsageCreditsEnabled(): Promise<boolean | null> {
  try {
    const state = JSON.parse((await readFile(getClaudeStatePath(), 'utf8')).replace(/^\uFEFF/, ''))
    if (!isRecord(state) || !isRecord(state['oauthAccount'])) return null
    const enabled = state['oauthAccount']['hasExtraUsageEnabled']
    return typeof enabled === 'boolean' ? enabled : null
  } catch {
    return null
  }
}

/**
 * Uses only the newest payload. Missing limits remain unavailable rather than
 * silently borrowing potentially outdated account data from another session.
 */
function selectNewestSnapshot(snapshots: LiveUsageSnapshot[]): SelectedUsageSnapshot | null {
  if (snapshots.length === 0) return null

  const newest = [...snapshots].sort((left, right) =>
    right.capturedAt.localeCompare(left.capturedAt)
  )[0]
  return { snapshot: newest }
}

/** Uses the newest still-relevant status-line limits only as an account API fallback. */
function selectNewestLimits(
  snapshots: LiveUsageSnapshot[],
  now: number
): SelectedUsageLimits | null {
  const candidate = [...snapshots]
    .filter(
      (snapshot) =>
        snapshot.rateLimits.fiveHour !== undefined || snapshot.rateLimits.sevenDay !== undefined
    )
    .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))[0]
  if (!candidate || now - Date.parse(candidate.capturedAt) > APP.accountUsageFallbackMaxAgeMs) {
    return null
  }

  const rateLimits = Object.fromEntries(
    Object.entries(candidate.rateLimits).filter(
      ([, limit]) => !limit.resetsAt || Date.parse(limit.resetsAt) > now
    )
  ) as LiveUsageSnapshot['rateLimits']
  if (!rateLimits.fiveHour && !rateLimits.sevenDay) return null
  return { rateLimits, updatedAt: candidate.capturedAt }
}

export async function clearLiveUsageSnapshots(): Promise<void> {
  await Promise.all([
    rm(getUsageDirectory(), { force: true, recursive: true }),
    clearAccountUsageCache(),
    clearUsageCaptureError(),
  ])
}

/**
 * Writes the raw status-line payload for post-capture inspection.
 *
 * It carries session identifiers and workspace paths, so it gets the same
 * owner-only, atomic treatment as every other file Reup persists: a partial
 * write must never be observable by `reup usage raw`, and the contents must not
 * be readable by other accounts on a shared machine.
 */
export async function writeRawCapture(rawJson: string): Promise<void> {
  await writeTextAtomically(join(getReupDirectory(), 'usage-last-raw.json'), rawJson)
}

/** Reads back the last raw status-line payload, or null if none exists. */
export async function readRawCapture(): Promise<string | null> {
  try {
    return await readFile(join(getReupDirectory(), 'usage-last-raw.json'), 'utf8')
  } catch {
    return null
  }
}

async function readUsageCaptureIntegrationState(): Promise<UsageCaptureIntegrationState> {
  let marker: unknown
  try {
    marker = JSON.parse(
      (await readFile(join(getReupDirectory(), INTEGRATION_FILE_NAME), 'utf8')).replace(
        /^\uFEFF/,
        ''
      )
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { configured: false, issue: null, markerPresent: false }
    }
    return {
      configured: false,
      issue:
        'cannot read the Reup usage integration marker; run `reup usage setup --replace` to repair it',
      markerPresent: true,
    }
  }

  if (!isRecord(marker) || typeof marker['installedCommand'] !== 'string') {
    return {
      configured: false,
      issue:
        'the Reup usage integration marker is invalid; run `reup usage setup --replace` to repair it',
      markerPresent: true,
    }
  }

  try {
    const settings = JSON.parse(
      (await readFile(join(getClaudeDirectory(), 'settings.json'), 'utf8')).replace(/^\uFEFF/, '')
    )
    const statusLine =
      isRecord(settings) && isRecord(settings['statusLine']) ? settings['statusLine'] : null
    if (statusLine?.['command'] !== marker['installedCommand']) {
      return {
        configured: false,
        issue:
          'Claude Code is not using the Reup status line; run `reup usage setup --replace` to restore it',
        markerPresent: true,
      }
    }
    if (
      statusLine['type'] !== 'command' ||
      statusLine['refreshInterval'] !== APP.usageCaptureRefreshSeconds
    ) {
      return {
        configured: false,
        issue:
          'the Reup status line refresh configuration is incomplete; run `reup usage setup` to repair it',
        markerPresent: true,
      }
    }
    return { configured: true, issue: null, markerPresent: true }
  } catch {
    return {
      configured: false,
      issue: 'cannot verify the Claude Code status line; run `reup usage setup` to repair it',
      markerPresent: true,
    }
  }
}

async function readUsageCaptureError(): Promise<UsageCaptureError | null> {
  try {
    const value = JSON.parse(
      await readFile(join(getReupDirectory(), CAPTURE_ERROR_FILE_NAME), 'utf8')
    )
    return isRecord(value) &&
      isTimestamp(value['occurredAt']) &&
      typeof value['message'] === 'string'
      ? { message: value['message'], occurredAt: value['occurredAt'] }
      : null
  } catch {
    return null
  }
}

function determineCaptureStatus(
  integration: UsageCaptureIntegrationState,
  captureError: UsageCaptureError | null,
  snapshot: LiveUsageSnapshot | null,
  freshness: LiveUsageSummary['freshness']
): UsageCaptureStatus {
  if (integration.issue || (integration.markerPresent && !integration.configured)) {
    return 'misconfigured'
  }
  if (!integration.configured) return 'off'
  if (
    captureError &&
    (!snapshot || captureError.occurredAt.localeCompare(snapshot.capturedAt) > 0)
  ) {
    return 'error'
  }
  if (!snapshot) return 'waiting'
  return freshness === 'fresh' ? 'live' : 'stale'
}

async function readLiveUsageSnapshots(): Promise<LiveUsageSnapshot[]> {
  let fileNames: string[]
  try {
    fileNames = await readdir(getUsageDirectory())
  } catch {
    return []
  }

  const snapshots = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith('.json'))
      .map(async (fileName) => {
        try {
          const parsed = JSON.parse(await readFile(join(getUsageDirectory(), fileName), 'utf8'))
          return isLiveUsageSnapshot(parsed) ? parsed : null
        } catch {
          return null
        }
      })
  )
  return snapshots.filter((snapshot): snapshot is LiveUsageSnapshot => snapshot !== null)
}

function parseLimitWindow(input: unknown): UsageLimitWindow | undefined {
  if (!isRecord(input)) return undefined
  const usedPercentage = percentageValue(input['used_percentage'])
  if (usedPercentage === undefined) return undefined

  const resetEpochSeconds = nonNegativeNumber(input['resets_at'])
  return {
    resetsAt:
      resetEpochSeconds === undefined ? null : new Date(resetEpochSeconds * 1_000).toISOString(),
    usedPercentage,
  }
}

function parseStatusLinePayload(payload: unknown): StatusLinePayload | null {
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload.replace(/^\uFEFF/, ''))
    } catch {
      return null
    }
  }
  return isRecord(payload) ? (payload as StatusLinePayload) : null
}

function isLiveUsageSnapshot(value: unknown): value is LiveUsageSnapshot {
  return (
    isRecord(value) &&
    value['schemaVersion'] === USAGE_SCHEMA_VERSION &&
    isTimestamp(value['capturedAt']) &&
    typeof value['sessionId'] === 'string' &&
    value['sessionId'].length > 0 &&
    isRecord(value['rateLimits'])
  )
}

function stableSessionKey(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex')
}

function getUsageDirectory(): string {
  return join(getReupDirectory(), 'usage')
}

async function renameWithContentionRetry(
  sourcePath: string,
  destinationPath: string
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(sourcePath, destinationPath)
      return
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code
      const canRetry =
        attempt < MAX_RENAME_RETRIES && (errorCode === 'EACCES' || errorCode === 'EPERM')
      if (!canRetry) throw error
      await new Promise<void>((resolve) =>
        setTimeout(resolve, RENAME_RETRY_DELAY_MS * (attempt + 1))
      )
    }
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await writeTextAtomically(path, JSON.stringify(value))
}

/** Owner-only atomic write into the Reup directory: temp file, then rename. */
async function writeTextAtomically(path: string, contents: string): Promise<void> {
  await mkdir(getReupDirectory(), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 })
    await renameWithContentionRetry(temporaryPath, path)
  } finally {
    await unlink(temporaryPath).catch(() => {})
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function percentageValue(value: unknown): number | undefined {
  const percentage = nonNegativeNumber(value)
  return percentage === undefined ? undefined : Math.min(100, percentage)
}
