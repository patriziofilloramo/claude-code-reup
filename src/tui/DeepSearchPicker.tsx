import { useEffect, useState } from 'react'
import { Box, Text, render, useApp, useInput, useStdout } from 'ink'

import { getActiveSessions } from '../core/session/active-sessions.js'
import { COLORS } from '../config/theme.js'
import type { ContentMatch } from '../core/session/session-search.js'
import type { Project } from '../core/session/session-model.js'
import { relativeTime } from '../utils/time.js'
import { createVisibleWindow } from './session-view.js'

// header(1) + blank(1) + col-header(1) + rows-margin-bottom(1) + footer-border+content(2) + 1 buffer
const CHROME_ROWS = 7

function truncate(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`
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
}: {
  query: string
  projects: Project[]
  onSelect: (match: ContentMatch) => void
  onBack?: () => void
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
        getActiveSessions(),
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

  // Each result occupies 2 terminal rows (table row + snippet line)
  const maxVisible = Math.max(2, Math.floor(((stdout?.rows ?? 20) - CHROME_ROWS) / 2))
  const items = results ?? []

  const rowData: RowData[] = items.map((m) => {
    const projectName = m.project.path.split(/[/\\]/).filter(Boolean).pop() ?? m.project.path
    return {
      active: activeIds.has(m.session.id),
      project: truncate(projectName, 24),
      session: truncate(m.session.alias ?? m.session.name, 36),
      updated: relativeTime(m.session.updated),
      matches: m.matchCount === 1 ? '1 hit' : `${m.matchCount} hits`,
      id: m.session.id.slice(0, 8),
      snippet: m.snippet,
    }
  })

  const paired = items.map((match, i) => ({ match, row: rowData[i] as RowData }))
  const [visiblePairs, visibleSelected] = createVisibleWindow(paired, selectedIndex, maxVisible)

  const widths =
    rowData.length === 0
      ? { state: 8, project: 7, session: 7, updated: 7, matches: 7, id: 9 }
      : {
          state: 8,
          project: Math.max(7, ...rowData.map((r) => r.project.length)),
          session: Math.max(7, ...rowData.map((r) => r.session.length)),
          updated: Math.max(7, ...rowData.map((r) => r.updated.length)),
          matches: Math.max(7, ...rowData.map((r) => r.matches.length)),
          id: 9,
        }

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

  // Snippet indent: past cursor(2) + state column(state+2)
  const snippetIndent = '  ' + ' '.repeat(widths.state + 2 + 2)

  return (
    <Box flexDirection="column">
      <Box gap={2} marginBottom={1} paddingX={1}>
        <Text>
          deep search:{' '}
          <Text bold color={COLORS.accent}>
            {query}
          </Text>
        </Text>
        {isLoading ? (
          <Text color={COLORS.dim}>
            scanning {progress.scanned}/{progress.total}…
          </Text>
        ) : (
          <Text color={COLORS.muted}>
            {results.length} session{results.length !== 1 ? 's' : ''} found
          </Text>
        )}
      </Box>

      <Box paddingX={1}>
        <Text color={COLORS.dim}>
          {'  '}
          {'STATE'.padEnd(widths.state + 2)}
          {'PROJECT'.padEnd(widths.project + 2)}
          {'SESSION'.padEnd(widths.session + 2)}
          {'UPDATED'.padEnd(widths.updated + 2)}
          {'MATCHES'.padEnd(widths.matches + 2)}
          {'ID PREFIX'}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {isLoading ? (
          <Box paddingX={1}>
            <Text color={COLORS.muted}>Scanning transcripts…</Text>
          </Box>
        ) : results.length === 0 ? (
          <Box paddingX={1}>
            <Text color={COLORS.muted}>No sessions contain "{query}".</Text>
          </Box>
        ) : (
          visiblePairs.map(({ match, row }, idx) => {
            const isSelected = idx === visibleSelected
            const stateText = row.active ? '● active' : '○ idle'
            const stateColor = row.active ? COLORS.ok : COLORS.dim
            return (
              <Box key={match.session.id} flexDirection="column" paddingX={1}>
                <Box>
                  <Text color={isSelected ? COLORS.accent : COLORS.dim}>
                    {isSelected ? '▶ ' : '  '}
                  </Text>
                  <Text color={stateColor}>{stateText.padEnd(widths.state + 2)}</Text>
                  <Text bold={isSelected} color={isSelected ? COLORS.text : COLORS.muted}>
                    {row.project.padEnd(widths.project + 2)}
                  </Text>
                  <Text bold={isSelected}>{row.session.padEnd(widths.session + 2)}</Text>
                  <Text color={COLORS.dim}>{row.updated.padEnd(widths.updated + 2)}</Text>
                  <Text color={COLORS.dim}>{row.matches.padEnd(widths.matches + 2)}</Text>
                  <Text color={COLORS.dim}>{row.id}</Text>
                </Box>
                <Box>
                  <Text color={COLORS.dim} wrap="truncate">
                    {snippetIndent}
                    <Text color={isSelected ? COLORS.muted : COLORS.dim}>{row.snippet}</Text>
                  </Text>
                </Box>
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
        {onBack && (
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>esc · tab</Text> back
          </Text>
        )}
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>↑↓</Text> navigate
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>q</Text> quit
        </Text>
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
