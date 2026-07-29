import { useEffect, useState } from 'react'

import { Box, Text } from 'ink'

import { LABELS } from '../../config/labels.js'
import { COLORS } from '../../config/theme.js'
import type { SessionLiveState } from '../../core/session/session-live-state.js'
import type { Project, Session } from '../../core/session/session-model.js'
import { primaryStatus } from '../../core/session/session-signals.js'
import { relativeTime } from '../../utils/time.js'
import type { SessionPanelLayout } from '../layout.js'
import {
  SESSION_MARKER_PULSE_FRAME_COUNT,
  SESSION_MARKER_PULSE_INTERVAL_MS,
  SESSION_MARKER_WIDTH,
  sessionStatusMarker,
} from '../session-status-marker.js'

interface SessionListProps {
  bulkSelectedIds: Set<string>
  isFocused: boolean
  /** Shared live reading per session; absent means detached. */
  liveStateBySession: Map<string, SessionLiveState>
  layout: SessionPanelLayout
  project: Project | null
  remotelyActiveSessionIds: Set<string>
  selectedIndex: number
  sessions: Session[]
  totalCount: number
}

const TAG_CHIPS_MAX = 2

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

export default function SessionList({
  bulkSelectedIds,
  isFocused,
  layout,
  liveStateBySession,
  project,
  remotelyActiveSessionIds,
  selectedIndex,
  sessions,
  totalCount,
}: SessionListProps) {
  const [pulseFrame, setPulseFrame] = useState(0)
  // Exactly the states the marker draws with a pulse.
  const hasVisibleBusySession = sessions.some((session) => {
    const liveState = liveStateBySession.get(session.id)
    return liveState === 'working' || liveState === 'needs-input'
  })

  useEffect(() => {
    if (!hasVisibleBusySession) return
    const intervalId = setInterval(
      () => setPulseFrame((frame) => (frame + 1) % SESSION_MARKER_PULSE_FRAME_COUNT),
      SESSION_MARKER_PULSE_INTERVAL_MS
    )
    return () => clearInterval(intervalId)
  }, [hasVisibleBusySession])

  const showHeader = layout.showHeader
  const showSummary = layout.showRelativeTime
  const showFullSummary = layout.showExtendedSummary

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
      {showHeader ? (
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
      ) : null}

      {sessions.length === 0 && (
        <Box marginTop={1} paddingX={1}>
          <Text color={COLORS.dim}>{LABELS.noSessionsMatchSearch}</Text>
        </Box>
      )}

      {sessions.map((session, index) => {
        const isSelected = index === selectedIndex
        const isFocusedSelected = isSelected && isFocused
        const marker = sessionStatusMarker({
          isBulkSelected: bulkSelectedIds.has(session.id),
          isRemotelyActive: remotelyActiveSessionIds.has(session.id),
          liveState: liveStateBySession.get(session.id) ?? 'detached',
          pulseFrame,
          status: primaryStatus(session.signals),
        })
        const displayName = session.alias || session.name
        const branch = isSelected ? (session.currentBranch ?? session.gitBranch ?? null) : null
        const nameColor = session.signals.archived
          ? COLORS.muted
          : isFocusedSelected
            ? COLORS.accent
            : isSelected
              ? COLORS.text
              : COLORS.textSub
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
            <Box flexShrink={0} width={SESSION_MARKER_WIDTH}>
              <Text color={marker.color} dimColor={marker.dim}>
                {marker.glyph}{' '}
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} overflow="hidden">
              <Text bold={isSelected} color={nameColor} wrap="truncate">
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
