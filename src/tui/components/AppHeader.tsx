import { Box, Text, useStdout } from 'ink'

import { COLORS } from '../../config/theme.js'
import type { LiveUsageSummary, UsageLimitWindow } from '../../core/usage/live-usage.js'
import { relativeTime } from '../../utils/time.js'

const USAGE_BAR_WIDTH = 10

interface AppHeaderProps {
  usage?: LiveUsageSummary | null
  version: string
}

interface UsageLimitDisplay {
  barEmpty: string
  barFilled: string
  color: string
  label: string
  percentage: string
  reset: string
}

export interface UsageDisplay {
  creditsEnabled: boolean
  limits: UsageLimitDisplay[]
  statusText: string
}

export default function AppHeader({ usage, version }: AppHeaderProps) {
  const { stdout } = useStdout()
  const compact = (stdout?.columns ?? 80) < 100
  const usageDisplay = usage === undefined ? null : formatUsageDisplay(usage)

  return (
    <Box
      borderColor={COLORS.border}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      borderTop={false}
      flexDirection="column"
      paddingX={1}
    >
      <Box gap={2}>
        <Text bold color={COLORS.accent}>
          ccm
        </Text>
        {compact ? null : <Text color={COLORS.muted}>claude code session manager</Text>}
        <Text color={COLORS.border}>v{version}</Text>
      </Box>
      {usageDisplay ? <UsageSummary compact={compact} display={usageDisplay} /> : null}
    </Box>
  )
}

function UsageSummary({ compact, display }: { compact: boolean; display: UsageDisplay }) {
  return (
    <Box gap={2}>
      <Text color={COLORS.dim}>limits</Text>
      {display.limits.map((limit) => (
        <Box key={limit.label} gap={1}>
          <Text bold color={limit.color}>
            {limit.label}
          </Text>
          {compact ? null : (
            <Box>
              <Text color={limit.color}>{limit.barFilled}</Text>
              <Text color={COLORS.dim}>{limit.barEmpty}</Text>
            </Box>
          )}
          <Text color={limit.color}>{limit.percentage}</Text>
          {limit.reset ? <Text color={COLORS.dim}>{limit.reset}</Text> : null}
        </Box>
      ))}
      {compact ? null : display.statusText ? (
        <Text color={COLORS.muted}>{display.statusText}</Text>
      ) : null}
      {display.creditsEnabled ? <Text color={COLORS.ok}>credits on</Text> : null}
    </Box>
  )
}

export function formatUsageDisplay(usage: LiveUsageSummary | null): UsageDisplay {
  if (!usage) return { creditsEnabled: false, limits: [], statusText: 'loading' }

  const limits = [
    formatLimit('5h', usage.rateLimits.fiveHour),
    formatLimit('7d', usage.rateLimits.sevenDay),
  ].filter((limit): limit is UsageLimitDisplay => limit !== null)

  return {
    creditsEnabled: usage.usageCreditsEnabled === true,
    limits,
    statusText:
      statusTextForUsage(usage) || (limits.length === 0 ? 'account limits unavailable' : ''),
  }
}

function statusTextForUsage(usage: LiveUsageSummary): string {
  switch (usage.limitsStatus) {
    case 'fresh':
      return ''
    case 'stale':
      return usage.limitsUpdatedAt ? `updated ${relativeTime(usage.limitsUpdatedAt)}` : ''
    case 'unavailable':
      return 'limits unavailable'
    default:
      return ''
  }
}

function formatLimit(label: string, limit: UsageLimitWindow | undefined): UsageLimitDisplay | null {
  if (!limit) return null
  const { filled, empty } = formatUsageBar(limit.usedPercentage)
  return {
    barFilled: filled,
    barEmpty: empty,
    color: colorForUsage(limit.usedPercentage),
    label,
    percentage: `${Math.round(limit.usedPercentage)}%`,
    reset: formatCompactReset(limit.resetsAt),
  }
}

function formatUsageBar(percentage: number): { filled: string; empty: string } {
  const clamped = Math.max(0, Math.min(100, percentage))
  const filledCount = clamped <= 0 ? 0 : Math.max(1, Math.ceil((clamped / 100) * USAGE_BAR_WIDTH))
  return {
    filled: '━'.repeat(filledCount),
    empty: '─'.repeat(USAGE_BAR_WIDTH - filledCount),
  }
}

function colorForUsage(percentage: number): string {
  if (percentage >= 100) return COLORS.danger
  if (percentage >= 90) return COLORS.orange
  if (percentage >= 80) return COLORS.warn
  return COLORS.accent
}

function formatCompactReset(resetAt: string | null): string {
  if (!resetAt) return ''
  const remainingMinutes = Math.ceil((new Date(resetAt).getTime() - Date.now()) / 60_000)
  if (remainingMinutes <= 0) return 'reset now'

  const days = Math.floor(remainingMinutes / (24 * 60))
  const hours = Math.floor((remainingMinutes % (24 * 60)) / 60)
  const minutes = remainingMinutes % 60
  if (days > 0) return `reset ${days}d${hours > 0 ? ` ${hours}h` : ''}`
  if (hours > 0) return `reset ${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`
  return `reset ${minutes}m`
}
