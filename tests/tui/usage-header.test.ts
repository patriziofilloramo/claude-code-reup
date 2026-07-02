import { describe, expect, it } from 'vitest'

import { COLORS } from '../../src/config/theme.js'
import type { LiveUsageSummary } from '../../src/core/usage/live-usage.js'
import { formatUsageDisplay } from '../../src/tui/components/AppHeader.js'
import { usageHeaderLayoutForWidth } from '../../src/tui/layout.js'

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

  it('hides account limits on very narrow terminals and compacts before that', () => {
    expect(usageHeaderLayoutForWidth(29).mode).toBe('hidden')
    expect(usageHeaderLayoutForWidth(30).mode).toBe('minimal')
    expect(usageHeaderLayoutForWidth(34).mode).toBe('minimal')
    expect(usageHeaderLayoutForWidth(35).mode).toBe('compact')
    expect(usageHeaderLayoutForWidth(48).mode).toBe('compact')
    expect(usageHeaderLayoutForWidth(120).mode).toBe('full')
  })

  it('keeps only usage bars and percentages in minimal mode', () => {
    expect(usageHeaderLayoutForWidth(34)).toMatchObject({
      mode: 'minimal',
      showBars: true,
      showBrandProduct: false,
      showLimitLabels: false,
      showLimitsLabel: false,
      showPercentage: true,
      showReset: false,
      showSummary: true,
      showStatus: false,
    })
  })

  it('keeps usage bars in compact mode while dropping reset chatter', () => {
    expect(usageHeaderLayoutForWidth(48)).toMatchObject({
      mode: 'compact',
      showBars: true,
      showBrandProduct: false,
      showLimitLabels: true,
      showLimitsLabel: true,
      showPercentage: true,
      showReset: false,
      showSummary: true,
      showStatus: false,
    })
    expect(usageHeaderLayoutForWidth(120)).toMatchObject({
      mode: 'full',
      showBars: true,
      showBrandProduct: true,
      showLimitLabels: true,
      showLimitsLabel: true,
      showPercentage: true,
      showReset: true,
      showSummary: true,
      showStatus: true,
    })
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
