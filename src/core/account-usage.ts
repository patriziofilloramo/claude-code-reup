import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { APP } from '../config/app.js'
import { getCcmDirectory, getClaudeDirectory } from './claude-paths.js'
import type { UsageLimitWindow } from './live-usage.js'

const ACCOUNT_USAGE_CACHE_FILE_NAME = 'account-usage.json'
const ACCOUNT_USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
const ACCOUNT_USAGE_SCHEMA_VERSION = 1
const MAX_RENAME_RETRIES = 5
const OAUTH_BETA_HEADER = 'oauth-2025-04-20'
const RENAME_RETRY_DELAY_MS = 10

let refreshInProgress: Promise<AccountUsageResult> | null = null

export interface AccountUsageSnapshot {
  fetchedAt: string
  rateLimits: {
    fiveHour?: UsageLimitWindow
    sevenDay?: UsageLimitWindow
  }
  schemaVersion: typeof ACCOUNT_USAGE_SCHEMA_VERSION
  usageCreditsEnabled: boolean | null
}

export interface AccountUsageResult {
  issue: string | null
  snapshot: AccountUsageSnapshot | null
  status: 'fresh' | 'stale' | 'unavailable'
}

interface AccountUsageResponse {
  extra_usage?: { is_enabled?: unknown }
  five_hour?: { resets_at?: unknown; utilization?: unknown }
  seven_day?: { resets_at?: unknown; utilization?: unknown }
}

/**
 * Reads Claude's account-limit endpoint with the same local OAuth credentials
 * Claude Code already manages. Credentials are never returned, logged, or cached.
 */
export async function readAccountUsage(now = Date.now()): Promise<AccountUsageResult> {
  const cached = await readCachedAccountUsage()
  if (cached && now - Date.parse(cached.fetchedAt) <= APP.accountUsageRefreshMs) {
    return { issue: null, snapshot: cached, status: 'fresh' }
  }

  if (!refreshInProgress) {
    refreshInProgress = refreshAccountUsage(cached, now).finally(() => {
      refreshInProgress = null
    })
  }
  return refreshInProgress
}

export async function clearAccountUsageCache(): Promise<void> {
  await unlink(getAccountUsageCachePath()).catch(() => {})
}

async function refreshAccountUsage(
  cached: AccountUsageSnapshot | null,
  now: number
): Promise<AccountUsageResult> {
  try {
    const accessToken = await readClaudeAccessToken()
    const response = await fetch(ACCOUNT_USAGE_ENDPOINT, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        'anthropic-beta': OAUTH_BETA_HEADER,
        'user-agent': `claude-ccm/${APP.version}`,
      },
      signal: AbortSignal.timeout(APP.accountUsageRequestTimeoutMs),
    })
    if (!response.ok) throw new Error(`account usage request returned HTTP ${response.status}`)

    const snapshot = parseAccountUsageResponse(await response.json(), new Date(now).toISOString())
    if (!snapshot) throw new Error('account usage response did not contain supported fields')

    await writeCachedAccountUsage(snapshot)
    return { issue: null, snapshot, status: 'fresh' }
  } catch (error) {
    const issue = error instanceof Error ? error.message : String(error)
    if (cached && now - Date.parse(cached.fetchedAt) <= APP.accountUsageFallbackMaxAgeMs) {
      return { issue, snapshot: cached, status: 'stale' }
    }
    return { issue, snapshot: null, status: 'unavailable' }
  }
}

function parseAccountUsageResponse(value: unknown, fetchedAt: string): AccountUsageSnapshot | null {
  if (!isRecord(value)) return null
  const response = value as AccountUsageResponse
  const fiveHour = parseLimitWindow(response.five_hour)
  const sevenDay = parseLimitWindow(response.seven_day)
  const creditsEnabled = response.extra_usage?.is_enabled
  const usageCreditsEnabled = typeof creditsEnabled === 'boolean' ? creditsEnabled : null

  if (!fiveHour && !sevenDay && usageCreditsEnabled === null) return null
  return {
    fetchedAt,
    rateLimits: {
      ...(fiveHour ? { fiveHour } : {}),
      ...(sevenDay ? { sevenDay } : {}),
    },
    schemaVersion: ACCOUNT_USAGE_SCHEMA_VERSION,
    usageCreditsEnabled,
  }
}

function parseLimitWindow(value: unknown): UsageLimitWindow | undefined {
  if (!isRecord(value)) return undefined
  const usedPercentage = percentageValue(value['utilization'])
  if (usedPercentage === undefined) return undefined

  return {
    resetsAt: timestampValue(value['resets_at']),
    usedPercentage,
  }
}

async function readClaudeAccessToken(): Promise<string> {
  const credentialsPath = join(getClaudeDirectory(), '.credentials.json')
  const credentials = JSON.parse((await readFile(credentialsPath, 'utf8')).replace(/^\uFEFF/, ''))
  if (!isRecord(credentials) || !isRecord(credentials['claudeAiOauth'])) {
    throw new Error('Claude OAuth credentials are unavailable')
  }

  const accessToken = credentials['claudeAiOauth']['accessToken']
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('Claude OAuth access token is unavailable')
  }
  return accessToken
}

async function readCachedAccountUsage(): Promise<AccountUsageSnapshot | null> {
  try {
    const value = JSON.parse(await readFile(getAccountUsageCachePath(), 'utf8'))
    return isAccountUsageSnapshot(value) ? value : null
  } catch {
    return null
  }
}

async function writeCachedAccountUsage(snapshot: AccountUsageSnapshot): Promise<void> {
  const cachePath = getAccountUsageCachePath()
  const temporaryPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(getCcmDirectory(), { recursive: true })
  try {
    await writeFile(temporaryPath, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 })
    await renameWithContentionRetry(temporaryPath, cachePath)
  } finally {
    await unlink(temporaryPath).catch(() => {})
  }
}

function getAccountUsageCachePath(): string {
  return join(getCcmDirectory(), ACCOUNT_USAGE_CACHE_FILE_NAME)
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

function isAccountUsageSnapshot(value: unknown): value is AccountUsageSnapshot {
  const rateLimits = isRecord(value) && isRecord(value['rateLimits']) ? value['rateLimits'] : null
  return (
    isRecord(value) &&
    value['schemaVersion'] === ACCOUNT_USAGE_SCHEMA_VERSION &&
    timestampValue(value['fetchedAt']) !== null &&
    rateLimits !== null &&
    isOptionalUsageLimitWindow(rateLimits['fiveHour']) &&
    isOptionalUsageLimitWindow(rateLimits['sevenDay']) &&
    (typeof value['usageCreditsEnabled'] === 'boolean' || value['usageCreditsEnabled'] === null)
  )
}

function isOptionalUsageLimitWindow(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      percentageValue(value['usedPercentage']) !== undefined &&
      (value['resetsAt'] === null || timestampValue(value['resetsAt']) !== null))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function percentageValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(100, value)
    : undefined
}

function timestampValue(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null
}
