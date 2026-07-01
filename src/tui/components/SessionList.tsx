import { useEffect, useState } from 'react'

import { Box, Text, useStdout } from 'ink'

import { LABELS } from '../../config/labels.js'
import { COLORS } from '../../config/theme.js'
import type { Project, Session } from '../../core/session/session-model.js'
import { primaryStatus } from '../../core/session/session-signals.js'
import { relativeTime } from '../../utils/time.js'

interface SessionListProps {
  activeSessionIds: Set<string>
  attentionSessionIds: Set<string>
  bulkSelectedIds: Set<string>
  busySessionIds: Set<string>
  isFocused: boolean
  project: Project | null
  remotelyActiveSessionIds: Set<string>
  selectedIndex: number
  sessions: Session[]
  totalCount: number
}

interface StatusBadge {
  color: string
  text: string
}

const TAG_CHIPS_MAX = 2

/** Pulse cycle for sessions whose Claude Code process reports busy work. */
const BUSY_PULSE_FRAMES = ['●', '◉', '○', '◉'] as const
const BUSY_PULSE_INTERVAL_MS = 250

interface LivenessGlyph {
  color: string
  glyph: string
}

/** Attention pulse alternates so a waiting session visibly demands the user. */
const ATTENTION_PULSE_FRAMES = ['!', '!', ' ', '!'] as const

/**
 * Chooses the per-row liveness indicator. A session waiting on the user
 * outranks everything and pulses red; busy sessions pulse green so a working
 * agent is visibly different from a merely attached (idle) process.
 */
export function sessionLivenessGlyph(
  isActive: boolean,
  isBusy: boolean,
  isRemotelyActive: boolean,
  pulseFrame: number,
  needsAttention = false
): LivenessGlyph {
  if (needsAttention) {
    return {
      color: COLORS.danger,
      glyph: ATTENTION_PULSE_FRAMES[pulseFrame % ATTENTION_PULSE_FRAMES.length] as string,
    }
  }
  if (isBusy) {
    return {
      color: COLORS.ok,
      glyph: BUSY_PULSE_FRAMES[pulseFrame % BUSY_PULSE_FRAMES.length] as string,
    }
  }
  if (isActive) return { color: COLORS.ok, glyph: '●' }
  if (isRemotelyActive) return { color: COLORS.muted, glyph: '◌' }
  return { color: COLORS.border, glyph: '●' }
}

export function formatTagChips(tags: string[]): string {
  const shown = tags.slice(0, TAG_CHIPS_MAX)
  const overflow = tags.length - shown.length
  const chips = shown.map((t) => '#' + t).join(' ')
  return overflow > 0 ? chips + ' +' + overflow : chips
}

export function formatTokenCount(tokenCount: number): string {
  if (tokenCount < 1_000) return String(tokenCount)
  if (tokenCount < 1_000_000) return `${(tokenCount / 1_000).toFixed(tokenCount < 10_000 ? 1 : 0)}k`
  return `${(tokenCount / 1_000_000).toFixed(1)}m`
}

export function formatSessionSummary(session: Session): string {
  const context =
    session.context.latestContextTokens === null
      ? ''
      : ` · ${formatTokenCount(session.context.latestContextTokens)} ctx`
  return `${relativeTime(session.updated)} · ${session.messageCount} msgs${context}`
}

/**
 * Returns a single-character ASCII status badge for sessions that need attention.
 * Heavily-compacted sessions are intentionally omitted — it is not actionable.
 */
function statusBadgeForSession(session: Session): StatusBadge | null {
  switch (primaryStatus(session.signals)) {
    case 'interrupted':
      return { text: '!', color: COLORS.warn }
    case 'expiring':
    case 'path-missing':
      return { text: '!', color: COLORS.danger }
    default:
      return null
  }
}

export default function SessionList({
  activeSessionIds,
  attentionSessionIds,
  bulkSelectedIds,
  busySessionIds,
  isFocused,
  project,
  remotelyActiveSessionIds,
  selectedIndex,
  sessions,
  totalCount,
}: SessionListProps) {
  const [pulseFrame, setPulseFrame] = useState(0)
  const hasVisibleBusySession = sessions.some(
    (session) => busySessionIds.has(session.id) || attentionSessionIds.has(session.id)
  )

  useEffect(() => {
    if (!hasVisibleBusySession) return
    const intervalId = setInterval(
      () => setPulseFrame((frame) => (frame + 1) % BUSY_PULSE_FRAMES.length),
      BUSY_PULSE_INTERVAL_MS
    )
    return () => clearInterval(intervalId)
  }, [hasVisibleBusySession])

  const { stdout } = useStdout()
  const terminalWidth = stdout?.columns ?? 80
  // ≥100: full summary (time · msgs · ctx · branch)
  // 70–99: time only
  // <70: no summary, no arrow
  const showArrow = terminalWidth >= 70
  const showSummary = terminalWidth >= 70
  const showFullSummary = terminalWidth >= 100

  const labelColor = isFocused ? COLORS.accent : COLORS.dim

  if (!project) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text color={COLORS.dim}>{LABELS.selectProjectHint}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box gap={1}>
        <Text bold color={labelColor}>
          {LABELS.wordSessions}
        </Text>
        <Text color={isFocused ? COLORS.accent : COLORS.dim}>({totalCount})</Text>
        {showFullSummary ? (
          <Box flexGrow={1} flexShrink={1}>
            <Text color={COLORS.muted} wrap="truncate">
              {project.path}
            </Text>
          </Box>
        ) : null}
      </Box>

      {sessions.length === 0 && (
        <Box marginTop={1} paddingX={1}>
          <Text color={COLORS.dim}>{LABELS.noSessionsMatchSearch}</Text>
        </Box>
      )}

      {sessions.map((session, index) => {
        const isSelected = index === selectedIndex
        const isFocusedSelected = isSelected && isFocused
        const isBulkSelected = bulkSelectedIds.has(session.id)
        const badge = statusBadgeForSession(session)
        const displayName = session.alias || session.name
        const branch = isSelected ? (session.currentBranch ?? session.gitBranch ?? null) : null
        const nameColor = session.signals.archived
          ? COLORS.muted
          : isSelected
            ? COLORS.text
            : COLORS.textSub

        const arrowColor = isFocusedSelected
          ? COLORS.accent
          : isBulkSelected
            ? COLORS.warn
            : COLORS.border
        const summary = showSummary
          ? '  ' +
            (showFullSummary
              ? formatSessionSummary(session) + (branch ? '  ' + branch : '')
              : relativeTime(session.updated))
          : null

        const tagChips =
          showFullSummary && session.tags && session.tags.length > 0
            ? formatTagChips(session.tags)
            : null

        return (
          <Box key={session.id} marginBottom={0}>
            <Box flexShrink={0}>
              {showArrow ? <Text color={arrowColor}>▶ </Text> : null}
              <Text color={badge?.color ?? COLORS.dim}>{badge?.text ?? ' '} </Text>
              {(() => {
                const liveness = sessionLivenessGlyph(
                  activeSessionIds.has(session.id),
                  busySessionIds.has(session.id),
                  remotelyActiveSessionIds.has(session.id),
                  pulseFrame,
                  attentionSessionIds.has(session.id)
                )
                return <Text color={liveness.color}>{liveness.glyph} </Text>
              })()}
            </Box>
            <Box flexGrow={1} flexShrink={1} overflow="hidden">
              <Text color={nameColor} wrap="truncate">
                {displayName}
              </Text>
              {tagChips ? (
                <Text color={COLORS.accent} wrap="truncate">
                  {'  ' + tagChips}
                </Text>
              ) : null}
              {summary ? (
                <Text color={COLORS.dim} wrap="truncate">
                  {summary}
                </Text>
              ) : null}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
