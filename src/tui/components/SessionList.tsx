import { Box, Text, useStdout } from 'ink'

import { COLORS } from '../../config/theme.js'
import type { Project, Session } from '../../core/session-model.js'
import { primaryStatus } from '../../core/session-signals.js'
import { relativeTime } from '../../utils/time.js'

export type Density = 'compact' | 'comfortable'

interface SessionListProps {
  activeSessionIds: Set<string>
  bulkSelectedIds: Set<string>
  density: Density
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
  bulkSelectedIds,
  density,
  isFocused,
  project,
  remotelyActiveSessionIds,
  selectedIndex,
  sessions,
  totalCount,
}: SessionListProps) {
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
      <Box flexDirection="column" flexGrow={1} paddingX={2}>
        <Text color={COLORS.dim}>Select a project with → or enter</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box gap={1} paddingX={1}>
        <Text bold color={labelColor}>sessions</Text>
        <Text color={isFocused ? COLORS.accent : COLORS.dim}>({totalCount})</Text>
        {showFullSummary ? (
          <Box flexGrow={1} flexShrink={1}>
            <Text color={COLORS.muted} wrap="truncate">{project.path}</Text>
          </Box>
        ) : null}
      </Box>

      {sessions.length === 0 && (
        <Box marginTop={1} paddingX={2}>
          <Text color={COLORS.dim}>No sessions match your search</Text>
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

        const arrowColor = isFocusedSelected ? COLORS.accent : isBulkSelected ? COLORS.warn : COLORS.border
        const summary = showSummary
          ? '  ' + (showFullSummary
              ? formatSessionSummary(session) + (branch ? '  ' + branch : '')
              : relativeTime(session.updated))
          : null

        return (
          <Box key={session.id} marginBottom={density === 'comfortable' ? 1 : 0} paddingX={1}>
            <Box flexShrink={0}>
              {showArrow ? <Text color={arrowColor}>▶ </Text> : null}
              <Text color={badge?.color ?? COLORS.dim}>{badge?.text ?? ' '} </Text>
              <Text color={activeSessionIds.has(session.id) ? COLORS.ok : remotelyActiveSessionIds.has(session.id) ? COLORS.muted : COLORS.border}>{activeSessionIds.has(session.id) ? '● ' : remotelyActiveSessionIds.has(session.id) ? '◌ ' : '● '}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} overflow="hidden">
              <Text color={nameColor} wrap="truncate">{displayName}</Text>
              {summary ? <Text color={COLORS.dim} wrap="truncate">{summary}</Text> : null}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
