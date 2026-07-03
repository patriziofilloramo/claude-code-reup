import { useEffect, useState } from 'react'
import { Box, Text, render, useApp, useInput, useStdout } from 'ink'

import { LABELS } from '../config/labels.js'
import { COLORS } from '../config/theme.js'
import type { TouchedFileSummary } from '../core/session/session-file-search.js'
import { relativeTime } from '../utils/time.js'
import { pickerRowLayoutForWidth, type PickerRowLayout } from './picker-row-layout.js'
import { createVisibleWindow } from './session-view.js'
import { filterTouchedFiles } from './touched-finder-model.js'

interface TouchedFilePickerProps {
  files: TouchedFileSummary[]
  projectPath?: string
  subtitle?: string
  onSelect: (path: string) => void
  /**
   * Called to dismiss the picker. When provided the picker is embedded in a
   * parent Ink tree and must not call exit() (which would tear down the whole
   * app); when absent it runs standalone and exits the process.
   */
  onClose?: () => void
}

const PICKER_CHROME_ROWS = 7

/** Renders a touched path relative to its project root for compact display. */
function relativeToProject(filePath: string, projectPath: string | undefined): string {
  const fileSlash = filePath.replace(/\\/g, '/')
  const projectSlash = (projectPath ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (projectSlash && fileSlash.toLowerCase().startsWith(`${projectSlash.toLowerCase()}/`)) {
    return fileSlash.slice(projectSlash.length + 1)
  }
  return fileSlash
}

export function TouchedFilePicker({
  files,
  projectPath,
  subtitle,
  onSelect,
  onClose,
}: TouchedFilePickerProps) {
  const { exit } = useApp()
  const dismiss = onClose ?? exit
  const { stdout } = useStdout()
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const matchingFiles = filterTouchedFiles(files, query)
  const maximumVisibleRows = Math.max(4, (stdout?.rows ?? 20) - PICKER_CHROME_ROWS)
  const rowLayout = pickerRowLayoutForWidth(stdout?.columns)
  const [visibleFiles, visibleSelectedIndex] = createVisibleWindow(
    matchingFiles,
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
      dismiss()
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
      setSelectedIndex((index) => Math.min(Math.max(0, matchingFiles.length - 1), index + 1))
      return
    }
    if (!key.return) return

    const file = matchingFiles[Math.min(selectedIndex, Math.max(0, matchingFiles.length - 1))]
    if (!file) return
    onSelect(file.path)
    // Standalone usage resolves by exiting; when embedded the parent advances
    // to its next step and keeps the Ink tree alive.
    if (!onClose) exit()
  })

  return (
    <Box flexDirection="column" overflow="hidden" width={stdout?.columns}>
      <Box gap={1} paddingX={1}>
        <Text bold color={COLORS.accent}>
          {LABELS.touchedPickerTitle}
        </Text>
        <Text color={COLORS.dim}>
          {matchingFiles.length} {LABELS.wordFiles}
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text color={COLORS.muted} wrap="truncate">
          {isSearchOpen
            ? `${LABELS.searchPrefix} ${query}`
            : (subtitle ?? LABELS.touchedPickerSubtitle)}
        </Text>
      </Box>
      <Box flexDirection="column" marginY={1}>
        {matchingFiles.length === 0 ? (
          <Box paddingX={1}>
            <Text color={COLORS.muted}>{LABELS.noTouchedFilesSentence}</Text>
          </Box>
        ) : (
          visibleFiles.map((file, index) => (
            <TouchedFileRow
              file={file}
              isSelected={index === visibleSelectedIndex}
              key={file.path}
              layout={rowLayout}
              projectPath={projectPath}
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
          <Text color={COLORS.text}>{LABELS.keyEnter}</Text> {LABELS.wordOpen}
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.keySearch}</Text> {LABELS.wordSearch}
        </Text>
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

function TouchedFileRow({
  file,
  isSelected,
  layout,
  projectPath,
}: {
  file: TouchedFileSummary
  isSelected: boolean
  layout: PickerRowLayout
  projectPath?: string
}) {
  const sessionCount = `${file.sessionCount} ${LABELS.wordSessions}`
  return (
    <Box gap={1} height={1} overflow="hidden" paddingX={1} width={layout.width}>
      <Text color={isSelected ? COLORS.accent : COLORS.dim}>{isSelected ? '>' : ' '}</Text>
      <Box flexShrink={0} overflow="hidden" width={layout.primaryWidth}>
        <Text bold={isSelected} color={COLORS.text}>
          {relativeToProject(file.path, projectPath)}
        </Text>
      </Box>
      {layout.showTertiaryMeta && file.gitBranch ? (
        <Box flexShrink={0} overflow="hidden" width={layout.tertiaryMetaWidth}>
          <Text color={COLORS.accent}>{file.gitBranch}</Text>
        </Box>
      ) : null}
      {layout.showSecondaryMeta ? (
        <Box flexShrink={0} overflow="hidden" width={layout.secondaryMetaWidth}>
          <Text color={COLORS.muted}>{sessionCount}</Text>
        </Box>
      ) : null}
      {layout.showPrimaryMeta ? (
        <Box flexShrink={0} overflow="hidden" width={layout.primaryMetaWidth}>
          <Text color={COLORS.dim}>{relativeTime(file.lastTouchedAt)}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** Opens the touched-file picker and resolves the selected path. */
export function runTouchedFilePicker(
  files: TouchedFileSummary[],
  projectPath?: string
): Promise<string | null> {
  return new Promise((resolve) => {
    let selectedPath: string | null = null
    const { waitUntilExit } = render(
      <TouchedFilePicker
        files={files}
        onSelect={(path) => {
          selectedPath = path
        }}
        projectPath={projectPath}
      />
    )
    waitUntilExit()
      .then(() => resolve(selectedPath))
      .catch(() => resolve(null))
  })
}
