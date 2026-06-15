import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { APP } from '../../src/config/app.js'
import { readAccountUsage } from '../../src/core/usage/account-usage.js'

describe('account usage', () => {
  let originalClaudeDirectory: string | undefined
  let temporaryClaudeDirectory: string

  beforeEach(async () => {
    temporaryClaudeDirectory = await mkdtemp(join(tmpdir(), 'ccm-account-usage-test-'))
    originalClaudeDirectory = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = temporaryClaudeDirectory
    await writeCredentials('secret-access-token')
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    if (originalClaudeDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeDirectory
    await rm(temporaryClaudeDirectory, { force: true, recursive: true })
  })

  it('reads current account limits and reuses the short-lived local cache', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        extra_usage: { is_enabled: false },
        five_hour: { resets_at: '2026-06-11T18:10:00Z', utilization: 77 },
        seven_day: { resets_at: '2026-06-17T19:00:00Z', utilization: 28 },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const now = Date.parse('2026-06-11T15:00:00Z')
    await expect(readAccountUsage(now)).resolves.toMatchObject({
      issue: null,
      snapshot: {
        rateLimits: {
          fiveHour: { usedPercentage: 77 },
          sevenDay: { usedPercentage: 28 },
        },
        usageCreditsEnabled: false,
      },
      status: 'fresh',
    })
    await expect(readAccountUsage(now + APP.accountUsageRefreshMs - 1)).resolves.toMatchObject({
      status: 'fresh',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.anthropic.com/api/oauth/usage')
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: 'Bearer secret-access-token',
    })
    expect(
      await readFile(join(temporaryClaudeDirectory, 'ccm', 'account-usage.json'), 'utf8')
    ).not.toContain('secret-access-token')
  })

  it('returns a recent cached value as stale when refresh fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          five_hour: { resets_at: '2026-06-11T18:10:00Z', utilization: 77 },
          seven_day: { resets_at: '2026-06-17T19:00:00Z', utilization: 28 },
        })
      )
      .mockRejectedValueOnce(new Error('network unavailable'))
    vi.stubGlobal('fetch', fetchMock)

    const now = Date.parse('2026-06-11T15:00:00Z')
    await readAccountUsage(now)
    await expect(readAccountUsage(now + APP.accountUsageRefreshMs + 1)).resolves.toMatchObject({
      issue: 'network unavailable',
      snapshot: { rateLimits: { fiveHour: { usedPercentage: 77 } } },
      status: 'stale',
    })
  })

  it('reports unavailable without credentials and never attempts a request', async () => {
    await rm(join(temporaryClaudeDirectory, '.credentials.json'), { force: true })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(readAccountUsage()).resolves.toMatchObject({
      issue: expect.any(String),
      snapshot: null,
      status: 'unavailable',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores a corrupt cache instead of exposing malformed limits', async () => {
    await mkdir(join(temporaryClaudeDirectory, 'ccm'), { recursive: true })
    await writeFile(
      join(temporaryClaudeDirectory, 'ccm', 'account-usage.json'),
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        rateLimits: { fiveHour: 'invalid' },
        schemaVersion: 1,
        usageCreditsEnabled: false,
      })
    )
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')))

    await expect(readAccountUsage()).resolves.toMatchObject({
      issue: 'network unavailable',
      snapshot: null,
      status: 'unavailable',
    })
  })

  async function writeCredentials(accessToken: string): Promise<void> {
    await mkdir(temporaryClaudeDirectory, { recursive: true })
    await writeFile(
      join(temporaryClaudeDirectory, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken } })
    )
  }
})

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  })
}
