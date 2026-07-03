import { useEffect, useState } from 'react'
import { Box, Text, render, useApp, useInput, useStdout } from 'ink'

import { LABELS } from '../config/labels.js'
import { COLORS } from '../config/theme.js'
import type { Project } from '../core/session/session-model.js'
import type { RankedSession } from '../core/session/session-ranking.js'
import { filterSessionCandidates } from '../core/session/session-ranking.js'
import { relativeTime } from '../utils/time.js'
import { DeepSearchPicker } from './DeepSearchPicker.js'
import {
  maximumVisibleRowsForTerminal,
  pickerSessionRowLayoutForWidth,
  type PickerRowLayout,
} from './picker-row-layout.js'
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

function ResumePickerShell({
  candidates,
  currentDirectory,
  initialQuery,
  onSelect,
  projects,
}: {
  candidates: RankedSession[]
  currentDirectory?: string
  initialQuery?: string
  onSelect: (selection: ResumePickerSelection) => void
  projects?: Project[]
}) {
  const [mode, setMode] = useState<'normal' | 'deep'>('normal')
  const [deepQuery, setDeepQuery] = useState(initialQuery ?? '')

  function openDeepSearch(query: string): void {
    setDeepQuery(query)
    setMode('deep')
  }

  if (mode === 'deep' && projects) {
    return (
      <DeepSearchPicker
        query={deepQuery}
        projects={projects}
        onBack={() => setMode('normal')}
        onSelect={(match) =>
          onSelect({
            projectPath: match.session.projectPath,
            sessionId: match.session.id,
          })
        }
      />
    )
  }

  return (
    <ResumePicker
      candidates={candidates}
      currentDirectory={currentDirectory}
      initialQuery={initialQuery}
      onDeepSearch={projects ? openDeepSearch : undefined}
      onSelect={onSelect}
    />
  )
}

export function ResumePicker({
  candidates,
  currentDirectory,
  initialQuery,
  onSelect,
  onDeepSearch,
}: ResumePickerProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [isSearchOpen, setIsSearchOpen] = useState(initialQuery !== undefined)
  const [query, setQuery] = useState(initialQuery ?? '')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const matchingCandidates = filterSessionCandidates(candidates, query)
  const maximumVisibleRows = maximumVisibleRowsForTerminal(stdout?.rows, PICKER_CHROME_ROWS, 20)
  const rowLayout = pickerSessionRowLayoutForWidth(stdout?.columns)
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
    <Box flexDirection="column" overflow="hidden" width={stdout?.columns}>
      <Box gap={1} paddingX={1}>
        <Text bold color={COLORS.accent}>
          {LABELS.resumePickerDirectoryTitle}
        </Text>
        <Text color={COLORS.dim}>
          {matchingCandidates.length} {LABELS.wordSessions}
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text color={COLORS.muted} wrap="truncate">
          {isSearchOpen
            ? `search: ${query}`
            : `${LABELS.currentDirectoryLabel} ${currentDirectory ?? LABELS.unknownLabel}`}
        </Text>
      </Box>
      <Box flexDirection="column" marginY={1}>
        {matchingCandidates.length === 0 ? (
          <Box paddingX={1}>
            <Text color={COLORS.muted}>{LABELS.noSessionsMatchSentence}</Text>
          </Box>
        ) : (
          visibleCandidates.map((candidate, index) => (
            <ResumePickerRow
              candidate={candidate}
              isSelected={index === visibleSelectedIndex}
              key={candidate.session.id}
              layout={rowLayout}
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
          <Text color={COLORS.text}>{LABELS.keySearch}</Text> {LABELS.wordSearch}
        </Text>
        {onDeepSearch && isSearchOpen && (
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>{LABELS.keyTab}</Text>{' '}
            {LABELS.hintDeepSearch.replace('tab ', '')}
          </Text>
        )}
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.keyUpDownWords}</Text> {LABELS.wordNavigate}
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.keyEsc}</Text> {LABELS.wordQuit}
        </Text>
      </Box>
    </Box>
  )
}

function ResumePickerRow({
  candidate,
  isSelected,
  layout,
}: {
  candidate: RankedSession
  isSelected: boolean
  layout: PickerRowLayout
}) {
  const { project, session } = candidate
  const projectName = project.path.split(/[/\\]/).filter(Boolean).pop() ?? project.path
  const sessionName = session.alias ?? session.name

  return (
    <Box gap={1} height={1} overflow="hidden" paddingX={1} width={layout.width}>
      <Text color={isSelected ? COLORS.accent : COLORS.dim}>{isSelected ? '>' : ' '}</Text>
      <Text color={candidate.active ? COLORS.ok : COLORS.dim}>{'\u25cf'}</Text>
      <Box flexShrink={0} overflow="hidden" width={layout.primaryWidth}>
        <Text bold={isSelected} color={session.signals.archived ? COLORS.muted : COLORS.text}>
          {sessionName}
        </Text>
      </Box>
      <Box flexShrink={0} overflow="hidden" width={layout.coreMetaWidth}>
        <Text color={COLORS.dim}>{session.id.slice(0, 8)}</Text>
      </Box>
      {layout.showTertiaryMeta && candidate.inCurrentDirectory ? (
        <Box flexShrink={0} overflow="hidden" width={layout.tertiaryMetaWidth}>
          <Text color={COLORS.accent}>{LABELS.currentLabel}</Text>
        </Box>
      ) : null}
      {layout.showSecondaryMeta ? (
        <Box flexShrink={0} overflow="hidden" width={layout.secondaryMetaWidth}>
          <Text color={COLORS.muted}>{projectName}</Text>
        </Box>
      ) : null}
      {layout.showPrimaryMeta ? (
        <Box flexShrink={0} overflow="hidden" width={layout.primaryMetaWidth}>
          <Text color={COLORS.dim}>{relativeTime(session.updated)}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** Opens a compact session picker and resolves the selected resume target. */
export function runResumePicker(
  candidates: RankedSession[],
  currentDirectory?: string,
  initialQuery?: string,
  projects?: Project[]
): Promise<ResumePickerSelection | null> {
  return new Promise((resolve) => {
    let selection: ResumePickerSelection | null = null
    const { waitUntilExit } = render(
      <ResumePickerShell
        candidates={candidates}
        currentDirectory={currentDirectory}
        initialQuery={initialQuery}
        projects={projects}
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
