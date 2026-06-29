import { useState } from 'react'
import { Box, Text, render, useApp, useInput, useStdout } from 'ink'

import type { ListedSession } from '../cli/list-command.js'
import { shortestUniqueIdPrefix } from '../cli/list-command.js'
import { COLORS } from '../config/theme.js'
import { relativeTime } from '../utils/time.js'
import { createVisibleWindow } from './session-view.js'

interface SearchResultsPickerProps {
  query: string
  sessions: ListedSession[]
  onSelect: (session: ListedSession) => void
  onDeepSearch?: (query: string) => void
}

// header(1) + blank(1) + col-header(1) + rows-margin-bottom(1) + footer-border+content(2)
const CHROME_ROWS = 6

function truncate(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`
}

interface RowData {
  fullId: string
  id: string
  project: string
  session: string
  updated: string
  active: boolean
}

export function SearchResultsPicker({
  query,
  sessions,
  onSelect,
  onDeepSearch,
}: SearchResultsPickerProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [selectedIndex, setSelectedIndex] = useState(0)

  const maxVisible = Math.max(4, (stdout?.rows ?? 24) - CHROME_ROWS)

  const rowData: RowData[] = sessions.map((s) => ({
    fullId: s.id,
    id: shortestUniqueIdPrefix(s.id, sessions),
    project: truncate(s.projectName, 24),
    session: truncate(s.alias ?? s.name, 36),
    updated: relativeTime(s.updated),
    active: s.active,
  }))

  const [visibleRows, visibleSelected] = createVisibleWindow(rowData, selectedIndex, maxVisible)

  const widths =
    rowData.length === 0
      ? { state: 8, project: 7, session: 7, updated: 7, id: 9 }
      : {
          state: 8,
          project: Math.max(7, ...rowData.map((r) => r.project.length)),
          session: Math.max(7, ...rowData.map((r) => r.session.length)),
          updated: Math.max(7, ...rowData.map((r) => r.updated.length)),
          id: Math.max(9, ...rowData.map((r) => r.id.length)),
        }

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      exit()
      return
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1))
      return
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(Math.max(0, sessions.length - 1), i + 1))
      return
    }
    if (key.tab && onDeepSearch) {
      onDeepSearch(query)
      return
    }
    if (key.return) {
      const session = sessions[Math.min(selectedIndex, Math.max(0, sessions.length - 1))]
      if (session) {
        onSelect(session)
        exit()
      }
    }
  })

  return (
    <Box flexDirection="column">
      <Box gap={2} marginBottom={1} paddingX={1}>
        <Text>
          search:{' '}
          <Text bold color={COLORS.accent}>
            {query}
          </Text>
        </Text>
        <Text color={COLORS.muted}>
          {sessions.length} session{sessions.length !== 1 ? 's' : ''} found
        </Text>
        {onDeepSearch ? (
          <Text bold color={COLORS.orange}>
            TAB deep search
            <Text color={COLORS.muted}> scans transcripts</Text>
          </Text>
        ) : null}
      </Box>

      <Box paddingX={1}>
        <Text color={COLORS.dim}>
          {'  '}
          {'STATE'.padEnd(widths.state + 2)}
          {'PROJECT'.padEnd(widths.project + 2)}
          {'SESSION'.padEnd(widths.session + 2)}
          {'UPDATED'.padEnd(widths.updated + 2)}
          {'ID PREFIX'}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {sessions.length === 0 ? (
          <Box paddingX={1}>
            <Text color={COLORS.muted}>No sessions match.</Text>
          </Box>
        ) : (
          visibleRows.map((row, index) => {
            const isSelected = index === visibleSelected
            const stateText = row.active ? '● active' : '○ idle'
            const stateColor = row.active ? COLORS.ok : COLORS.dim
            return (
              <Box key={row.fullId} paddingX={1}>
                <Text color={isSelected ? COLORS.accent : COLORS.dim}>
                  {isSelected ? '▶ ' : '  '}
                </Text>
                <Text color={stateColor}>{stateText.padEnd(widths.state + 2)}</Text>
                <Text bold={isSelected} color={isSelected ? COLORS.text : COLORS.muted}>
                  {row.project.padEnd(widths.project + 2)}
                </Text>
                <Text bold={isSelected}>{row.session.padEnd(widths.session + 2)}</Text>
                <Text color={COLORS.dim}>{row.updated.padEnd(widths.updated + 2)}</Text>
                <Text color={COLORS.dim}>{row.id}</Text>
              </Box>
            )
          })
        )}
      </Box>

      <Box
        borderBottom={false}
        borderColor={COLORS.border}
        borderLeft={false}
        borderRight={false}
        borderStyle="single"
        borderTop={true}
        gap={2}
        paddingX={1}
      >
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>enter</Text> resume
        </Text>
        {onDeepSearch && (
          <Text color={COLORS.orange}>
            <Text bold>tab</Text> deep search
          </Text>
        )}
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>↑↓</Text> navigate
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>esc</Text> quit
        </Text>
      </Box>
    </Box>
  )
}

export function runSearchResultsPicker(
  query: string,
  sessions: ListedSession[],
  onDeepSearch?: (query: string) => void
): Promise<ListedSession | null> {
  return new Promise((resolve) => {
    let selected: ListedSession | null = null
    const { waitUntilExit } = render(
      <SearchResultsPicker
        query={query}
        sessions={sessions}
        onSelect={(s) => {
          selected = s
        }}
        onDeepSearch={onDeepSearch}
      />
    )
    waitUntilExit()
      .then(() => resolve(selected))
      .catch(() => resolve(null))
  })
}
