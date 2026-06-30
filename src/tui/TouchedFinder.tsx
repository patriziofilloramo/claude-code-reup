import { useEffect, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'

import { LABELS } from '../config/labels.js'
import { COLORS } from '../config/theme.js'
import {
  collectTouchedFiles,
  searchTouchedFiles,
  type TouchedFileMatch,
  type TouchedFileSummary,
} from '../core/session/session-file-search.js'
import type { Project, Session } from '../core/session/session-model.js'
import { createVisibleWindow } from './session-view.js'
import { TouchedFilePicker } from './TouchedFilePicker.js'
import { buildTouchedSessionRows, type TouchedSessionRow } from './touched-finder-model.js'

interface TouchedFinderProps {
  projects: Project[]
  activeSessionIds: ReadonlySet<string>
  onResume: (session: Session) => void
  onClose: () => void
}

const SESSIONS_CHROME_ROWS = 7

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * A self-contained "find sessions by touched file" overlay. It runs the same
 * two steps as the CLI interactive flow — pick a file written across your
 * projects, then pick which session that wrote it to resume — but embedded in
 * the main TUI. Each step is a leaf component with its own input handling, so
 * exactly one input handler is ever mounted and they never conflict.
 */
export function TouchedFinder({
  projects,
  activeSessionIds,
  onResume,
  onClose,
}: TouchedFinderProps) {
  const [files, setFiles] = useState<TouchedFileSummary[] | null>(null)
  const [step, setStep] = useState<'files' | 'sessions'>('files')
  const [matches, setMatches] = useState<TouchedFileMatch[] | null>(null)
  const [selectedPath, setSelectedPath] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const summaries = await collectTouchedFiles(projects)
      if (!cancelled) setFiles(summaries)
    })()
    return () => {
      cancelled = true
    }
  }, [projects])

  useEffect(() => {
    if (step !== 'sessions' || !selectedPath) return
    let cancelled = false
    setMatches(null)
    void (async () => {
      const found = await searchTouchedFiles(selectedPath, projects)
      if (!cancelled) setMatches(found)
    })()
    return () => {
      cancelled = true
    }
  }, [step, selectedPath, projects])

  function backToFiles(): void {
    setStep('files')
    setMatches(null)
    setSelectedPath('')
  }

  if (step === 'sessions') {
    if (matches === null) {
      return (
        <TouchedLoadingView message={LABELS.deepSearchScanningTranscripts} onExit={backToFiles} />
      )
    }
    return (
      <TouchedSessionsView
        activeSessionIds={activeSessionIds}
        matches={matches}
        onBack={backToFiles}
        onResume={onResume}
        path={selectedPath}
      />
    )
  }

  if (files === null) {
    return <TouchedLoadingView message={LABELS.deepSearchScanningTranscripts} onExit={onClose} />
  }
  return (
    <TouchedFilePicker
      files={files}
      onClose={onClose}
      onSelect={(path) => {
        setSelectedPath(path)
        setStep('sessions')
      }}
      subtitle={LABELS.touchedFinderSubtitle}
    />
  )
}

// ---------------------------------------------------------------------------
// Sessions step
// ---------------------------------------------------------------------------

function TouchedSessionsView({
  matches,
  activeSessionIds,
  path,
  onResume,
  onBack,
}: {
  matches: TouchedFileMatch[]
  activeSessionIds: ReadonlySet<string>
  path: string
  onResume: (session: Session) => void
  onBack: () => void
}) {
  const { stdout } = useStdout()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const rows = buildTouchedSessionRows(matches, activeSessionIds)
  const maximumVisibleRows = Math.max(4, (stdout?.rows ?? 20) - SESSIONS_CHROME_ROWS)
  const paired = matches.map((match, index) => ({ match, row: rows[index] as TouchedSessionRow }))
  const [visiblePairs, visibleSelectedIndex] = createVisibleWindow(
    paired,
    selectedIndex,
    maximumVisibleRows
  )

  useInput((input, key) => {
    const escapePressed = key.escape || input === '\x1b'
    if (escapePressed || input === 'q') {
      onBack()
      return
    }
    if (key.upArrow) {
      setSelectedIndex((index) => Math.max(0, index - 1))
      return
    }
    if (key.downArrow) {
      setSelectedIndex((index) => Math.min(Math.max(0, matches.length - 1), index + 1))
      return
    }
    if (!key.return) return
    const match = matches[Math.min(selectedIndex, Math.max(0, matches.length - 1))]
    if (match) onResume(match.session)
  })

  return (
    <Box flexDirection="column">
      <Box gap={1} paddingX={1}>
        <Text bold color={COLORS.accent}>
          {LABELS.touchedPickerTitle}
        </Text>
        <Text color={COLORS.dim}>
          {matches.length} {LABELS.wordSessions}
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text color={COLORS.muted} wrap="truncate">
          {LABELS.touchedSessionsSubtitle} · {path}
        </Text>
      </Box>
      <Box flexDirection="column" marginY={1}>
        {matches.length === 0 ? (
          <Box paddingX={1}>
            <Text color={COLORS.muted}>{LABELS.noTouchedSessionsSentence}</Text>
          </Box>
        ) : (
          visiblePairs.map(({ match, row }, index) => (
            <TouchedSessionRowView
              isSelected={index === visibleSelectedIndex}
              key={match.session.id}
              row={row}
            />
          ))
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
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.keyEsc}</Text> {LABELS.wordBack}
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.keyUpDownWords}</Text> {LABELS.wordNavigate}
        </Text>
      </Box>
    </Box>
  )
}

function TouchedSessionRowView({
  row,
  isSelected,
}: {
  row: TouchedSessionRow
  isSelected: boolean
}) {
  return (
    <Box gap={1} paddingX={1}>
      <Text color={isSelected ? COLORS.accent : COLORS.dim}>{isSelected ? '>' : ' '}</Text>
      <Text color={row.active ? COLORS.ok : COLORS.dim}>{row.active ? '*' : 'o'}</Text>
      <Text bold={isSelected} color={COLORS.text} wrap="truncate">
        {row.session}
      </Text>
      <Text color={COLORS.muted}>{row.project}</Text>
      {row.branch ? <Text color={COLORS.accent}>{row.branch}</Text> : null}
      <Text color={COLORS.dim}>{row.when}</Text>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Loading step
// ---------------------------------------------------------------------------

function TouchedLoadingView({ message, onExit }: { message: string; onExit: () => void }) {
  useInput((input, key) => {
    if (key.escape || input === '\x1b' || input === 'q') onExit()
  })
  return (
    <Box paddingX={1} paddingY={1}>
      <Text color={COLORS.orange}>{message}</Text>
    </Box>
  )
}
