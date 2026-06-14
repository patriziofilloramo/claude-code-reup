import { useEffect, useState } from 'react'
import { Box, Text, render, useApp, useInput, useStdout } from 'ink'

import { COLORS } from '../config/theme.js'
import type { RankedSession } from '../core/session-ranking.js'
import { filterSessionCandidates } from '../core/session-ranking.js'
import { relativeTime } from '../utils/time.js'
import { createVisibleWindow } from './session-view.js'

export interface ResumePickerSelection {
  projectPath: string
  sessionId: string
}

interface ResumePickerProps {
  candidates: RankedSession[]
  currentDirectory?: string
  initialQuery?: string
  onSelect: (selection: ResumePickerSelection) => void
  onDeepSearch?: (query: string) => void
}

const PICKER_CHROME_ROWS = 7

export function ResumePicker({ candidates, currentDirectory, initialQuery, onSelect, onDeepSearch }: ResumePickerProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [isSearchOpen, setIsSearchOpen] = useState(initialQuery !== undefined)
  const [query, setQuery] = useState(initialQuery ?? '')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const matchingCandidates = filterSessionCandidates(candidates, query)
  const maximumVisibleRows = Math.max(4, (stdout?.rows ?? 20) - PICKER_CHROME_ROWS)
  const [visibleCandidates, visibleSelectedIndex] = createVisibleWindow(
    matchingCandidates,
    selectedIndex,
    maximumVisibleRows
  )

  useEffect(() => setSelectedIndex(0), [query])

  useInput((input, key) => {
    const escapePressed = key.escape || input === '\x1b'

    if (isSearchOpen) {
      if (escapePressed) {
        setIsSearchOpen(false)
        setQuery('')
        return
      }
      if (key.tab && onDeepSearch) {
        onDeepSearch(query)
        return
      }
      if (key.backspace || key.delete) {
        setQuery((value) => value.slice(0, -1))
        return
      }
      if (!key.upArrow && !key.downArrow && !key.return && input && !key.ctrl && !key.meta) {
        setQuery((value) => value + input)
        return
      }
    }

    if (escapePressed || input === 'q') {
      exit()
      return
    }
    if (input === '/') {
      setIsSearchOpen(true)
      return
    }
    if (key.upArrow) {
      setSelectedIndex((index) => Math.max(0, index - 1))
      return
    }
    if (key.downArrow) {
      setSelectedIndex((index) => Math.min(Math.max(0, matchingCandidates.length - 1), index + 1))
      return
    }
    if (!key.return) return

    const candidate =
      matchingCandidates[Math.min(selectedIndex, Math.max(0, matchingCandidates.length - 1))]
    if (!candidate) return

    onSelect({
      projectPath: candidate.session.projectPath,
      sessionId: candidate.session.id,
    })
    exit()
  })

  return (
    <Box flexDirection="column">
      <Box gap={1} paddingX={1}>
        <Text bold color={COLORS.accent}>
          CCM RESUME
        </Text>
        <Text color={COLORS.dim}>{matchingCandidates.length} sessions</Text>
      </Box>
      <Box paddingX={1}>
        <Text color={COLORS.muted} wrap="truncate">
          {isSearchOpen
            ? `search: ${query}`
            : `current directory: ${currentDirectory ?? 'unknown'}`}
        </Text>
      </Box>
      <Box flexDirection="column" marginY={1}>
        {matchingCandidates.length === 0 ? (
          <Box paddingX={1}>
            <Text color={COLORS.muted}>No sessions match.</Text>
          </Box>
        ) : (
          visibleCandidates.map((candidate, index) => (
            <ResumePickerRow
              candidate={candidate}
              isSelected={index === visibleSelectedIndex}
              key={candidate.session.id}
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
          <Text color={COLORS.text}>enter</Text> resume
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>/</Text> search
        </Text>
        {onDeepSearch && isSearchOpen && (
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>tab</Text> deep search
          </Text>
        )}
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>up/down</Text> navigate
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>esc</Text> quit
        </Text>
      </Box>
    </Box>
  )
}

function ResumePickerRow({
  candidate,
  isSelected,
}: {
  candidate: RankedSession
  isSelected: boolean
}) {
  const { project, session } = candidate
  const projectName = project.path.split(/[/\\]/).filter(Boolean).pop() ?? project.path
  const sessionName = session.alias ?? session.name

  return (
    <Box gap={1} paddingX={1}>
      <Text color={isSelected ? COLORS.accent : COLORS.dim}>{isSelected ? '>' : ' '}</Text>
      <Text color={candidate.active ? COLORS.ok : COLORS.dim}>{candidate.active ? '*' : 'o'}</Text>
      <Text
        bold={isSelected}
        color={session.signals.archived ? COLORS.muted : COLORS.text}
        wrap="truncate"
      >
        {sessionName}
      </Text>
      {candidate.inCurrentDirectory ? <Text color={COLORS.accent}>current</Text> : null}
      <Text color={COLORS.muted}>{projectName}</Text>
      <Text color={COLORS.dim}>{relativeTime(session.updated)}</Text>
      <Text color={COLORS.dim}>{session.id.slice(0, 8)}</Text>
    </Box>
  )
}

/** Opens a compact session picker and resolves the selected resume target. */
export function runResumePicker(
  candidates: RankedSession[],
  currentDirectory?: string,
  initialQuery?: string,
  onDeepSearch?: (query: string) => void,
): Promise<ResumePickerSelection | null> {
  return new Promise((resolve) => {
    let selection: ResumePickerSelection | null = null
    const { waitUntilExit } = render(
      <ResumePicker
        candidates={candidates}
        currentDirectory={currentDirectory}
        initialQuery={initialQuery}
        onDeepSearch={onDeepSearch}
        onSelect={(selectedSession) => {
          selection = selectedSession
        }}
      />
    )
    waitUntilExit()
      .then(() => resolve(selection))
      .catch(() => resolve(null))
  })
}
