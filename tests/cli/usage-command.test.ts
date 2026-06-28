import { describe, expect, it } from 'vitest'

import {
  formatStatusLineUsage,
  formatUsageSummary,
  renderUsageSummary,
} from '../../src/cli/usage-command.js'
import type { LiveUsageSnapshot, LiveUsageSummary } from '../../src/core/usage/live-usage.js'

const SNAPSHOT: LiveUsageSnapshot = {
  agentName: 'reviewer',
  capturedAt: new Date().toISOString(),
  contextUsedPercentage: 42,
  modelDisplayName: 'Sonnet',
  rateLimits: {
    fiveHour: { resetsAt: null, usedPercentage: 81 },
    sevenDay: { resetsAt: null, usedPercentage: 23 },
  },
  schemaVersion: 1,
  sessionId: 'session-one',
}

describe('usage command formatting', () => {
  it('prints a compact status-line value from supported fields', () => {
    expect(formatStatusLineUsage(SNAPSHOT)).toBe('reup | ctx 42% | 5h 81% | 7d 23%')
  })

  it('distinguishes unavailable, waiting, fresh, and stale states', () => {
    expect(formatUsageSummary(summary(null, false, 'unavailable'))).toContain('limits unavailable')
    expect(formatUsageSummary(summary(null, true, 'unavailable'))).toContain('limits unavailable')
    expect(formatUsageSummary(summary(SNAPSHOT, true, 'fresh'))).toContain('5h 81%')
    expect(formatUsageSummary(summary(SNAPSHOT, true, 'fresh'))).toContain('limits updated')
    expect(formatUsageSummary(summary(SNAPSHOT, true, 'fresh'))).not.toContain('live feed')
    expect(formatUsageSummary(summary(SNAPSHOT, true, 'stale'))).toContain('updated')
    expect(formatUsageSummary(summary(SNAPSHOT, true, 'stale'))).not.toContain('cached limits')
  })

  it('surfaces account-limit refresh failures', () => {
    const failed = summary(null, true, 'unavailable')
    failed.limitsIssue = 'account endpoint failed'
    expect(formatUsageSummary(failed)).toContain('account endpoint failed')
  })

  it('reports usage credits only when explicitly enabled', () => {
    const enabled = summary(SNAPSHOT, true, 'fresh')
    enabled.usageCreditsEnabled = true

    expect(formatUsageSummary(enabled)).toContain('usage credits on')
    expect(formatUsageSummary(summary(SNAPSHOT, true, 'fresh'))).not.toContain('usage credits on')
  })

  it('uses theme accent colour for normal account-limit consumption', () => {
    // 24-bit RGB matching theme accent #22d3ee
    expect(renderUsageSummary(summary(SNAPSHOT, true, 'fresh'))).toContain('\x1b[38;2;34;211;238m')
  })

  it('uses accent colour for stale bars — staleness is conveyed by the header note', () => {
    const output = renderUsageSummary(summary(SNAPSHOT, true, 'stale'))
    expect(output).toContain('\x1b[38;2;34;211;238m')
    expect(output).toContain('updated')
    expect(output).not.toContain('cached limits')
    expect(output).not.toContain('payload updated')
    expect(output).not.toContain('limits updated')
  })
})

function summary(
  snapshot: LiveUsageSnapshot | null,
  configured: boolean,
  freshness: LiveUsageSummary['freshness']
): LiveUsageSummary {
  return {
    captureIssue: null,
    captureStatus: snapshot
      ? freshness === 'stale'
        ? 'stale'
        : 'live'
      : configured
        ? 'waiting'
        : 'off',
    configured,
    freshness,
    limitsIssue: null,
    limitsSource: snapshot ? 'account-api' : 'unavailable',
    limitsStatus: snapshot ? (freshness === 'stale' ? 'stale' : 'fresh') : 'unavailable',
    limitsUpdatedAt: snapshot?.capturedAt ?? null,
    rateLimits: snapshot?.rateLimits ?? {},
    snapshot,
    updateStrategy: 'account-api-with-status-line-fallback',
    updatedAt: snapshot?.capturedAt ?? null,
    usageCreditsEnabled: false,
  }
}
