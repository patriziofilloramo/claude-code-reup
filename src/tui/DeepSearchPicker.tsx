import { useEffect, useState } from 'react'
import { Box, Text, render, useApp, useInput, useStdout } from 'ink'

import { getActiveSessions } from '../core/session/active-sessions.js'
import { LABELS } from '../config/labels.js'
import { COLORS } from '../config/theme.js'
import type { ContentMatch } from '../core/session/session-search.js'
import type { Project } from '../core/session/session-model.js'
import { relativeTime } from '../utils/time.js'
import {
  maximumVisibleItemPairsForTerminal,
  pickerSessionRowLayoutForWidth,
  type PickerRowLayout,
} from './picker-row-layout.js'
import { createVisibleWindow } from './session-view.js'

const FOOTER_ROWS = 2
// header(1) + blank(1) + rows-margin-bottom(1) + optional footer + 1 buffer
const CHROME_ROWS = 4 + FOOTER_ROWS

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

interface RowData {
  active: boolean
  project: string
  session: string
  updated: string
  matches: string
  id: string
  snippet: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function DeepSearchPicker({
  query,
  projects,
  onSelect,
  onBack,
  showFooter = true,
}: {
  query: string
  projects: Project[]
  onSelect: (match: ContentMatch) => void
  onBack?: () => void
  showFooter?: boolean
}) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [results, setResults] = useState<ContentMatch[] | null>(null)
  const [progress, setProgress] = useState({ scanned: 0, total: 0 })
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    setResults(null)
    setActiveIds(new Set())
    setSelectedIndex(0)

    async function run() {
      const { searchTranscripts } = await import('../core/session/session-search.js')
      const [matches, ids] = await Promise.all([
        searchTranscripts(query, projects, (scanned, total) => {
          if (!cancelled) setProgress({ scanned, total })
        }),
        getActiveSessions({ officialRefresh: 'background' }),
      ])
      if (!cancelled) {
        setResults(matches)
        setActiveIds(ids)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [query, projects])

  // Each result intentionally occupies 2 terminal rows: summary + snippet.
  const chromeRows = showFooter ? CHROME_ROWS : CHROME_ROWS - FOOTER_ROWS
  const maxVisible = maximumVisibleItemPairsForTerminal(stdout?.rows, chromeRows, 20)
  const items = results ?? []
  const rowLayout = pickerSessionRowLayoutForWidth(stdout?.columns)

  const rowData: RowData[] = items.map((m) => {
    const projectName = m.project.path.split(/[/\\]/).filter(Boolean).pop() ?? m.project.path
    return {
      active: activeIds.has(m.session.id),
      project: projectName,
      session: m.session.alias ?? m.session.name,
      updated: relativeTime(m.session.updated),
      matches: m.matchCount === 1 ? '1 hit' : `${m.matchCount} hits`,
      id: m.session.id.slice(0, 8),
      snippet: compactText(m.snippet),
    }
  })

  const paired = items.map((match, i) => ({ match, row: rowData[i] as RowData }))
  const [visiblePairs, visibleSelected] = createVisibleWindow(paired, selectedIndex, maxVisible)

  const isLoading = results === null

  useInput((input, key) => {
    const esc = key.escape || input === '\x1b'
    if (esc || key.tab) {
      if (onBack) onBack()
      else exit()
      return
    }
    if (input === 'q') {
      exit()
      return
    }
    if (isLoading) return
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1))
      return
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(Math.max(0, items.length - 1), i + 1))
      return
    }
    if (!key.return) return
    const match = items[selectedIndex]
    if (!match) return
    onSelect(match)
    exit()
  })

  return (
    <Box flexDirection="column" overflow="hidden" width={stdout?.columns}>
      <Box
        gap={2}
        height={1}
        marginBottom={1}
        overflow="hidden"
        paddingX={1}
        width={rowLayout.width}
      >
        <Text bold color={COLORS.orange}>
          {LABELS.deepSearchTitle}
        </Text>
        <Text>
          {LABELS.deepSearchQueryLabel}{' '}
          <Text bold color={COLORS.accent}>
            {query}
          </Text>
        </Text>
        {isLoading ? (
          <Text color={COLORS.orange}>
            {LABELS.deepSearchScanning} {progress.scanned}/{progress.total}...
          </Text>
        ) : (
          <Text color={COLORS.muted}>
            {results.length} {LABELS.wordSession}
            {results.length !== 1 ? 's' : ''} {LABELS.wordFound}
          </Text>
        )}
      </Box>

      <Box flexDirection="column" marginBottom={1} overflow="hidden" width={rowLayout.width}>
        {isLoading ? (
          <Box paddingX={1}>
            <Text color={COLORS.muted}>{LABELS.deepSearchScanningTranscripts}</Text>
          </Box>
        ) : results.length === 0 ? (
          <Box paddingX={1}>
            <Text color={COLORS.muted}>
              {LABELS.deepSearchNoSessionsContain} "{query}".
            </Text>
          </Box>
        ) : (
          visiblePairs.map(({ match, row }, idx) => {
            const isSelected = idx === visibleSelected
            return (
              <DeepSearchResultRow
                isSelected={isSelected}
                key={match.session.id}
                layout={rowLayout}
                row={row}
              />
            )
          })
        )}
      </Box>

      {showFooter ? (
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
          {onBack && (
            <Text color={COLORS.muted}>
              <Text color={COLORS.text}>
                {LABELS.keyEsc} · {LABELS.keyTab}
              </Text>{' '}
              {LABELS.wordBack}
            </Text>
          )}
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>{LABELS.keyUpDown}</Text> {LABELS.wordNavigate}
          </Text>
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>{LABELS.keyQuit}</Text> {LABELS.wordQuit}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

function DeepSearchResultRow({
  row,
  isSelected,
  layout,
}: {
  row: RowData
  isSelected: boolean
  layout: PickerRowLayout
}) {
  const snippetWidth = Math.max(1, layout.width - 6)

  return (
    <Box flexDirection="column" width={layout.width}>
      <Box gap={1} height={1} overflow="hidden" paddingX={1} width={layout.width}>
        <Text color={isSelected ? COLORS.accent : COLORS.dim}>{isSelected ? '>' : ' '}</Text>
        <Text color={row.active ? COLORS.ok : COLORS.dim}>{'\u25cf'}</Text>
        <Box flexShrink={0} overflow="hidden" width={layout.primaryWidth}>
          <Text bold={isSelected} color={isSelected ? COLORS.text : COLORS.muted}>
            {row.session}
          </Text>
        </Box>
        <Box flexShrink={0} overflow="hidden" width={layout.coreMetaWidth}>
          <Text color={COLORS.dim}>{row.id}</Text>
        </Box>
        {layout.showPrimaryMeta ? (
          <Box flexShrink={0} overflow="hidden" width={layout.primaryMetaWidth}>
            <Text color={isSelected ? COLORS.orange : COLORS.dim}>{row.matches}</Text>
          </Box>
        ) : null}
        {layout.showSecondaryMeta ? (
          <Box flexShrink={0} overflow="hidden" width={layout.secondaryMetaWidth}>
            <Text color={COLORS.muted}>{row.project}</Text>
          </Box>
        ) : null}
        {layout.showTertiaryMeta ? (
          <Box flexShrink={0} overflow="hidden" width={layout.tertiaryMetaWidth}>
            <Text color={COLORS.dim}>{row.updated}</Text>
          </Box>
        ) : null}
      </Box>
      <Box gap={1} height={1} marginBottom={1} overflow="hidden" paddingX={1} width={layout.width}>
        <Text color={isSelected ? COLORS.accent : COLORS.dim}>{'\u21b3'}</Text>
        <Box flexShrink={0} overflow="hidden" width={snippetWidth}>
          <Text color={isSelected ? COLORS.textSub : COLORS.dim}>{row.snippet}</Text>
        </Box>
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function runDeepSearchPicker(
  query: string,
  projects: Project[]
): Promise<ContentMatch | null> {
  return new Promise((resolve) => {
    let selection: ContentMatch | null = null
    const { waitUntilExit } = render(
      <DeepSearchPicker
        query={query}
        projects={projects}
        onSelect={(m) => {
          selection = m
        }}
      />
    )
    waitUntilExit()
      .then(() => resolve(selection))
      .catch(() => resolve(null))
  })
}

export { DeepSearchPicker }
