import { describe, expect, it } from 'vitest'

import { COLORS } from '../../src/config/theme.js'
import type { LiveUsageSummary } from '../../src/core/usage/live-usage.js'
import { formatUsageDisplay } from '../../src/tui/components/AppHeader.js'

describe('TUI usage header', () => {
  it('distinguishes off, waiting, stale, warning, and danger states', () => {
    expect(formatUsageDisplay(null).statusText).toBe('loading')
    expect(formatUsageDisplay(summary(null, false, 'unavailable')).statusText).toBe(
      'limits unavailable'
    )
    expect(formatUsageDisplay(summary(null, true, 'unavailable')).statusText).toBe(
      'limits unavailable'
    )
    expect(formatUsageDisplay(summary(81, true, 'fresh')).limits[0].color).toBe(COLORS.warn)
    expect(formatUsageDisplay(summary(90, true, 'fresh')).limits[0].color).toBe(COLORS.orange)
    expect(formatUsageDisplay(summary(100, true, 'fresh')).limits[0].color).toBe(COLORS.danger)
    expect(formatUsageDisplay(summary(100, true, 'stale')).limits[0].color).toBe(COLORS.danger)
    expect(formatUsageDisplay(summary(100, true, 'fresh')).statusText).toBe('')
    expect(formatUsageDisplay(summary(100, true, 'stale')).statusText).toContain('updated')
    expect(formatUsageDisplay(summary(100, true, 'stale')).statusText).not.toContain('cached')
    expect(formatUsageDisplay(summary(100, true, 'stale')).statusText).not.toContain('limits')
  })

  it('formats account limits as thin Unicode bar segments', () => {
    const usage = summary(42, true, 'fresh')
    if (!usage.snapshot?.rateLimits.fiveHour) throw new Error('fixture missing limit')
    usage.snapshot.contextUsedPercentage = 63
    usage.snapshot.modelDisplayName = 'Sonnet 4.6'
    if (!usage.rateLimits.fiveHour) throw new Error('fixture missing account limit')
    usage.rateLimits.fiveHour.resetsAt = '2100-01-01T00:00:00.000Z'

    const display = formatUsageDisplay(usage)
    expect(display.limits[0]).toMatchObject({
      barFilled: '━━━━━',
      barEmpty: '─────',
      label: '5h',
      percentage: '42%',
    })
    expect(display.limits[0].reset).toMatch(/^reset \d+d \d+h$/)
    expect(JSON.stringify(display)).not.toMatch(/[·↻]/)
  })

  it('shows the usage-credits badge only when explicitly enabled', () => {
    const enabled = summary(42, true, 'fresh')
    enabled.usageCreditsEnabled = true

    expect(formatUsageDisplay(enabled).creditsEnabled).toBe(true)
    expect(formatUsageDisplay(summary(42, true, 'fresh')).creditsEnabled).toBe(false)
  })
})

function summary(
  fiveHourPercentage: number | null,
  configured: boolean,
  freshness: LiveUsageSummary['freshness']
): LiveUsageSummary {
  return {
    captureIssue: null,
    captureStatus:
      fiveHourPercentage !== null
        ? freshness === 'stale'
          ? 'stale'
          : 'live'
        : configured
          ? 'waiting'
          : 'off',
    configured,
    freshness,
    limitsIssue: null,
    limitsSource: fiveHourPercentage === null ? 'unavailable' : 'account-api',
    limitsStatus:
      fiveHourPercentage === null ? 'unavailable' : freshness === 'stale' ? 'stale' : 'fresh',
    limitsUpdatedAt: fiveHourPercentage === null ? null : new Date().toISOString(),
    rateLimits:
      fiveHourPercentage === null
        ? {}
        : { fiveHour: { resetsAt: null, usedPercentage: fiveHourPercentage } },
    snapshot:
      fiveHourPercentage === null
        ? null
        : {
            capturedAt: new Date().toISOString(),
            rateLimits: {
              fiveHour: { resetsAt: null, usedPercentage: fiveHourPercentage },
            },
            schemaVersion: 1,
            sessionId: 'session',
          },
    updateStrategy: 'account-api-with-status-line-fallback',
    updatedAt: fiveHourPercentage === null ? null : new Date().toISOString(),
    usageCreditsEnabled: false,
  }
}
