import { useState } from 'react'
import { Box, Text, render, useApp, useInput, useStdout } from 'ink'

import type { ListedSession } from '../cli/list-command.js'
import { shortestUniqueIdPrefix } from '../cli/list-command.js'
import { LABELS } from '../config/labels.js'
import { COLORS } from '../config/theme.js'
import { relativeTime } from '../utils/time.js'
import {
  maximumVisibleRowsForTerminal,
  pickerSessionRowLayoutForWidth,
} from './picker-row-layout.js'
import { createVisibleWindow } from './session-view.js'

interface SearchResultsPickerProps {
  query: string
  sessions: ListedSession[]
  onSelect: (session: ListedSession) => void
  onDeepSearch?: (query: string) => void
}

// header(1) + blank(1) + rows-margin-bottom(1) + footer-border+content(2)
const CHROME_ROWS = 5

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

  const maxVisible = maximumVisibleRowsForTerminal(stdout?.rows, CHROME_ROWS, 24)
  const rowLayout = pickerSessionRowLayoutForWidth(stdout?.columns)

  const rowData: RowData[] = sessions.map((s) => ({
    fullId: s.id,
    id: shortestUniqueIdPrefix(s.id, sessions),
    project: s.projectName,
    session: s.alias ?? s.name,
    updated: relativeTime(s.updated),
    active: s.active,
  }))

  const [visibleRows, visibleSelected] = createVisibleWindow(rowData, selectedIndex, maxVisible)

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
    <Box flexDirection="column" overflow="hidden" width={stdout?.columns}>
      <Box gap={2} marginBottom={1} paddingX={1}>
        <Text>
          {LABELS.searchPrefix}{' '}
          <Text bold color={COLORS.accent}>
            {query}
          </Text>
        </Text>
        <Text color={COLORS.muted}>
          {sessions.length} {LABELS.wordSession}
          {sessions.length !== 1 ? 's' : ''} {LABELS.wordFound}
        </Text>
        {onDeepSearch ? (
          <Text bold color={COLORS.orange}>
            {LABELS.deepSearchCta}
            <Text color={COLORS.muted}> {LABELS.deepSearchScansTranscripts}</Text>
          </Text>
        ) : null}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {sessions.length === 0 ? (
          <Box paddingX={1}>
            <Text color={COLORS.muted}>{LABELS.noSessionsMatchSentence}</Text>
          </Box>
        ) : (
          visibleRows.map((row, index) => {
            const isSelected = index === visibleSelected
            const stateColor = row.active ? COLORS.ok : COLORS.dim
            return (
              <Box
                key={row.fullId}
                gap={1}
                height={1}
                overflow="hidden"
                paddingX={1}
                width={rowLayout.width}
              >
                <Text color={isSelected ? COLORS.accent : COLORS.dim}>
                  {isSelected ? '>' : ' '}
                </Text>
                <Text color={stateColor}>{'\u25cf'}</Text>
                <Box flexShrink={0} overflow="hidden" width={rowLayout.primaryWidth}>
                  <Text bold={isSelected} color={isSelected ? COLORS.text : COLORS.muted}>
                    {row.session}
                  </Text>
                </Box>
                <Box flexShrink={0} overflow="hidden" width={rowLayout.coreMetaWidth}>
                  <Text color={COLORS.dim}>{row.id}</Text>
                </Box>
                {rowLayout.showSecondaryMeta ? (
                  <Box flexShrink={0} overflow="hidden" width={rowLayout.secondaryMetaWidth}>
                    <Text color={COLORS.muted}>{row.project}</Text>
                  </Box>
                ) : null}
                {rowLayout.showPrimaryMeta ? (
                  <Box flexShrink={0} overflow="hidden" width={rowLayout.primaryMetaWidth}>
                    <Text color={COLORS.dim}>{row.updated}</Text>
                  </Box>
                ) : null}
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
          <Text color={COLORS.text}>{LABELS.keyEnter}</Text> {LABELS.wordResume}
        </Text>
        {onDeepSearch && (
          <Text color={COLORS.orange}>
            <Text bold>{LABELS.keyTab}</Text> {LABELS.hintDeepSearch.replace('tab ', '')}
          </Text>
        )}
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.keyUpDown}</Text> {LABELS.wordNavigate}
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.keyEsc}</Text> {LABELS.wordQuit}
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
