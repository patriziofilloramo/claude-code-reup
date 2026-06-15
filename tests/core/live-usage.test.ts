import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  clearUsageCaptureError,
  parseStatusLineUsage,
  readLiveUsageSummary,
  recordUsageCaptureError,
  writeLiveUsageSnapshot,
} from '../../src/core/usage/live-usage.js'

describe('live usage', () => {
  let originalClaudeDirectory: string | undefined
  let temporaryClaudeDirectory: string

  beforeEach(async () => {
    temporaryClaudeDirectory = await mkdtemp(join(tmpdir(), 'swoop-usage-test-'))
    originalClaudeDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = temporaryClaudeDirectory
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    if (originalClaudeDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeDirectory
    await rm(temporaryClaudeDirectory, { force: true, recursive: true })
    await rm(`${temporaryClaudeDirectory}.json`, { force: true })
  })

  it('keeps only supported aggregate status-line fields', () => {
    const snapshot = parseStatusLineUsage(
      {
        agent: { name: 'reviewer' },
        context_window: {
          context_window_size: 200_000,
          current_usage: { input_tokens: 123 },
          remaining_percentage: 68.8,
          used_percentage: 31.2,
        },
        cost: { total_cost_usd: 10 },
        model: { display_name: 'Sonnet', id: 'claude-sonnet-4-6' },
        rate_limits: {
          five_hour: { resets_at: 1_800_000_000, used_percentage: 82.4 },
          seven_day: { resets_at: 1_900_000_000, used_percentage: 24.5 },
        },
        session_id: 'session-one',
        transcript_path: '/private/transcript.jsonl',
      },
      '2026-06-10T20:00:00.000Z'
    )

    expect(snapshot).toEqual({
      agentName: 'reviewer',
      capturedAt: '2026-06-10T20:00:00.000Z',
      contextRemainingPercentage: 68.8,
      contextUsedPercentage: 31.2,
      contextWindowSize: 200_000,
      modelDisplayName: 'Sonnet',
      modelId: 'claude-sonnet-4-6',
      rateLimits: {
        fiveHour: {
          resetsAt: '2027-01-15T08:00:00.000Z',
          usedPercentage: 82.4,
        },
        sevenDay: {
          resetsAt: '2030-03-17T17:46:40.000Z',
          usedPercentage: 24.5,
        },
      },
      schemaVersion: 1,
      sessionId: 'session-one',
    })
    expect(JSON.stringify(snapshot)).not.toContain('transcript')
    expect(JSON.stringify(snapshot)).not.toContain('total_cost')
    expect(JSON.stringify(snapshot)).not.toContain('current_usage')
  })

  it('accepts a UTF-8 byte-order mark in raw status-line JSON', () => {
    expect(parseStatusLineUsage('\uFEFF{"session_id":"powershell-pipe"}')).toMatchObject({
      rateLimits: {},
      sessionId: 'powershell-pipe',
    })
  })

  it('writes concurrent sessions independently and returns the newest snapshot', async () => {
    const first = parseStatusLineUsage(
      { session_id: 'first', rate_limits: { five_hour: { used_percentage: 10 } } },
      '2026-06-10T20:00:00.000Z'
    )
    const second = parseStatusLineUsage(
      { session_id: 'second', rate_limits: { five_hour: { used_percentage: 20 } } },
      '2026-06-10T20:01:00.000Z'
    )
    if (!first || !second) throw new Error('fixture did not parse')

    await Promise.all([writeLiveUsageSnapshot(first), writeLiveUsageSnapshot(second)])

    const summary = await readLiveUsageSummary(new Date('2026-06-10T20:02:00.000Z').getTime())
    expect(summary).toMatchObject({
      configured: false,
      freshness: 'fresh',
      limitsUpdatedAt: '2026-06-10T20:01:00.000Z',
      snapshot: { sessionId: 'second' },
      updateStrategy: 'account-api-with-status-line-fallback',
      updatedAt: '2026-06-10T20:01:00.000Z',
    })
  })

  it('writes concurrent updates for the same session without temporary-file collisions', async () => {
    const snapshot = parseStatusLineUsage(
      { session_id: 'same-session', rate_limits: { five_hour: { used_percentage: 10 } } },
      '2026-06-10T20:00:00.000Z'
    )
    if (!snapshot) throw new Error('fixture did not parse')

    await expect(
      Promise.all(Array.from({ length: 20 }, () => writeLiveUsageSnapshot(snapshot)))
    ).resolves.toHaveLength(20)
  })

  it('trusts the newest payload instead of borrowing older account limits', async () => {
    const observedLimits = parseStatusLineUsage(
      {
        rate_limits: {
          five_hour: { resets_at: 1_800_000_000, used_percentage: 42 },
          seven_day: { resets_at: 1_900_000_000, used_percentage: 23 },
        },
        session_id: 'observed-limits',
      },
      '2026-06-10T20:00:00.000Z'
    )
    const newestSession = parseStatusLineUsage(
      { context_window: { used_percentage: 4 }, session_id: 'newest-session' },
      '2026-06-10T20:30:00.000Z'
    )
    if (!observedLimits || !newestSession) throw new Error('fixture did not parse')

    await Promise.all([
      writeLiveUsageSnapshot(observedLimits),
      writeLiveUsageSnapshot(newestSession),
    ])

    const summary = await readLiveUsageSummary(new Date('2026-06-10T20:31:00.000Z').getTime())
    expect(summary.snapshot).toMatchObject({
      contextUsedPercentage: 4,
      rateLimits: {},
      sessionId: 'newest-session',
    })
    expect(summary.limitsUpdatedAt).toBeNull()
  })

  it('uses current account limits when the newest status-line payload omits them', async () => {
    await configureCapture('swoop-capture')
    await writeFile(
      join(temporaryClaudeDirectory, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'test-token' } })
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              five_hour: { resets_at: '2026-06-11T23:00:00Z', utilization: 77 },
              seven_day: { resets_at: '2026-06-17T19:00:00Z', utilization: 28 },
            }),
            { status: 200 }
          )
      )
    )

    const snapshot = parseStatusLineUsage(
      { context_window: { used_percentage: 4 }, session_id: 'newest-session' },
      '2026-06-11T20:00:00.000Z'
    )
    if (!snapshot) throw new Error('fixture did not parse')
    await writeLiveUsageSnapshot(snapshot)

    await expect(
      readLiveUsageSummary(Date.parse('2026-06-11T20:01:00.000Z'))
    ).resolves.toMatchObject({
      limitsSource: 'account-api',
      limitsStatus: 'fresh',
      rateLimits: {
        fiveHour: { usedPercentage: 77 },
        sevenDay: { usedPercentage: 28 },
      },
      snapshot: { rateLimits: {}, sessionId: 'newest-session' },
    })
  })

  it('accepts the newest same-session values without preserving older limits', async () => {
    const observed = parseStatusLineUsage(
      {
        rate_limits: {
          five_hour: { resets_at: 1_800_000_000, used_percentage: 81 },
          seven_day: { resets_at: 1_900_000_000, used_percentage: 23 },
        },
        session_id: 'same-session',
      },
      '2026-06-10T20:00:00.000Z'
    )
    const intermittentZero = parseStatusLineUsage(
      {
        rate_limits: {
          five_hour: { resets_at: 1_800_000_000, used_percentage: 0 },
          seven_day: { resets_at: 2_000_000_000, used_percentage: 0 },
        },
        session_id: 'same-session',
      },
      '2026-06-10T20:01:00.000Z'
    )
    if (!observed || !intermittentZero) throw new Error('fixture did not parse')

    await writeLiveUsageSnapshot(observed)
    await writeLiveUsageSnapshot(intermittentZero)

    const summary = await readLiveUsageSummary(new Date('2026-06-10T20:02:00.000Z').getTime())
    expect(summary.snapshot?.rateLimits).toEqual({
      fiveHour: {
        resetsAt: '2027-01-15T08:00:00.000Z',
        usedPercentage: 0,
      },
      sevenDay: {
        resetsAt: '2033-05-18T03:33:20.000Z',
        usedPercentage: 0,
      },
    })
    expect(summary.limitsUpdatedAt).toBe('2026-06-10T20:01:00.000Z')
  })

  it('removes same-session limits when the newest payload omits them', async () => {
    const observed = parseStatusLineUsage(
      {
        rate_limits: {
          five_hour: { used_percentage: 42 },
        },
        session_id: 'same-session',
      },
      '2026-06-10T20:00:00.000Z'
    )
    const omitted = parseStatusLineUsage({ session_id: 'same-session' }, '2026-06-10T20:01:00.000Z')
    if (!observed || !omitted) throw new Error('fixture did not parse')

    await writeLiveUsageSnapshot(observed)
    await writeLiveUsageSnapshot(omitted)

    const summary = await readLiveUsageSummary(new Date('2026-06-10T20:02:00.000Z').getTime())
    expect(summary.snapshot?.rateLimits).toEqual({})
    expect(summary.limitsUpdatedAt).toBeNull()
  })

  it('reports stale and unavailable snapshots honestly', async () => {
    expect(await readLiveUsageSummary()).toMatchObject({
      freshness: 'unavailable',
      limitsUpdatedAt: null,
      snapshot: null,
      updateStrategy: 'account-api-with-status-line-fallback',
    })

    const snapshot = parseStatusLineUsage({ session_id: 'old' }, '2026-06-10T10:00:00.000Z')
    if (!snapshot) throw new Error('fixture did not parse')
    await writeLiveUsageSnapshot(snapshot)

    expect(
      await readLiveUsageSummary(new Date('2026-06-10T11:00:00.000Z').getTime())
    ).toMatchObject({ freshness: 'stale', limitsUpdatedAt: null, snapshot: { rateLimits: {} } })
  })

  it('reports live, stale, failed, and misconfigured capture states truthfully', async () => {
    await configureCapture('swoop-capture')
    const snapshot = parseStatusLineUsage(
      { session_id: 'health-check' },
      '2026-06-10T10:00:00.000Z'
    )
    if (!snapshot) throw new Error('fixture did not parse')
    await writeLiveUsageSnapshot(snapshot)

    await expect(
      readLiveUsageSummary(new Date('2026-06-10T10:01:00.000Z').getTime())
    ).resolves.toMatchObject({ captureIssue: null, captureStatus: 'live', configured: true })
    await expect(
      readLiveUsageSummary(new Date('2026-06-10T10:03:00.000Z').getTime())
    ).resolves.toMatchObject({
      captureIssue: expect.stringContaining('status-line payload'),
      captureStatus: 'stale',
      configured: true,
    })

    await recordUsageCaptureError(new Error('collector probe failed'))
    await expect(readLiveUsageSummary()).resolves.toMatchObject({
      captureIssue: 'collector probe failed',
      captureStatus: 'error',
      configured: true,
    })

    await clearUsageCaptureError()
    await writeFile(
      join(temporaryClaudeDirectory, 'settings.json'),
      JSON.stringify({ statusLine: { command: 'swoop-capture', type: 'command' } })
    )
    await expect(readLiveUsageSummary()).resolves.toMatchObject({
      captureIssue: expect.stringContaining('refresh configuration'),
      captureStatus: 'misconfigured',
      configured: false,
    })

    await writeFile(
      join(temporaryClaudeDirectory, 'settings.json'),
      JSON.stringify({ statusLine: { command: 'different-command', type: 'command' } })
    )
    await expect(readLiveUsageSummary()).resolves.toMatchObject({
      captureStatus: 'misconfigured',
      configured: false,
    })
  })

  it('reports the best-effort local usage-credits flag without guessing', async () => {
    await writeFile(
      `${temporaryClaudeDirectory}.json`,
      JSON.stringify({ oauthAccount: { hasExtraUsageEnabled: true } })
    )
    await expect(readLiveUsageSummary()).resolves.toMatchObject({ usageCreditsEnabled: true })

    await writeFile(
      `${temporaryClaudeDirectory}.json`,
      JSON.stringify({ oauthAccount: { hasExtraUsageEnabled: false } })
    )
    await expect(readLiveUsageSummary()).resolves.toMatchObject({ usageCreditsEnabled: false })

    await writeFile(`${temporaryClaudeDirectory}.json`, JSON.stringify({ oauthAccount: {} }))
    await expect(readLiveUsageSummary()).resolves.toMatchObject({ usageCreditsEnabled: null })
  })

  it('ignores corrupt snapshots instead of letting them hide a valid snapshot', async () => {
    const snapshot = parseStatusLineUsage({ session_id: 'valid' }, '2026-06-10T10:00:00.000Z')
    if (!snapshot) throw new Error('fixture did not parse')
    await writeLiveUsageSnapshot(snapshot)

    const usageDirectory = join(temporaryClaudeDirectory, 'swoop', 'usage')
    await mkdir(usageDirectory, { recursive: true })
    await writeFile(
      join(usageDirectory, 'corrupt.json'),
      JSON.stringify({ capturedAt: 'zzzz', rateLimits: {}, schemaVersion: 1, sessionId: 'corrupt' })
    )

    const summary = await readLiveUsageSummary(new Date('2026-06-10T10:01:00.000Z').getTime())
    expect(summary.snapshot?.sessionId).toBe('valid')
  })

  async function configureCapture(installedCommand: string): Promise<void> {
    await mkdir(join(temporaryClaudeDirectory, 'swoop'), { recursive: true })
    await Promise.all([
      writeFile(
        join(temporaryClaudeDirectory, 'settings.json'),
        JSON.stringify({
          statusLine: { command: installedCommand, refreshInterval: 10, type: 'command' },
        })
      ),
      writeFile(
        join(temporaryClaudeDirectory, 'swoop', 'statusline-integration.json'),
        JSON.stringify({ installedCommand })
      ),
    ])
  }
})
