import { Box, Text, useStdout } from 'ink'

import { LABELS } from '../../config/labels.js'
import { COLORS } from '../../config/theme.js'

interface AppFooterProps {
  bulkSelectedCount: number
  focusedPanel: 'projects' | 'sessions'
  isProjectActionMenuOpen: boolean
  isResumeCardOpen: boolean
  isSearchOpen: boolean
  isSessionActionMenuOpen: boolean
  isTouchedFinderOpen: boolean
  statusMessage: string | null
}

export default function AppFooter({
  bulkSelectedCount,
  focusedPanel,
  isProjectActionMenuOpen,
  isResumeCardOpen,
  isSearchOpen,
  isSessionActionMenuOpen,
  isTouchedFinderOpen,
  statusMessage,
}: AppFooterProps) {
  const { stdout } = useStdout()
  const compact = (stdout?.columns ?? 80) < 100

  // The touched finder is a full-screen overlay that renders its own
  // step-specific footer; stepping aside avoids a second, conflicting hint bar.
  if (isTouchedFinderOpen) return null

  function renderHints() {
    if (statusMessage) {
      return <Text color={COLORS.warn}>{statusMessage}</Text>
    }

    if (isResumeCardOpen) {
      return (
        <>
          <Text>
            <Text color={COLORS.ok}>▶ {LABELS.keyEnter}</Text>
            <Text color={COLORS.muted}>
              {' '}
              {LABELS.wordResume} {LABELS.wordSession}
            </Text>
          </Text>
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>{LABELS.keyFiles}</Text>
            {' ' + LABELS.wordFiles + '  '}
            <Text color={COLORS.text}>{LABELS.keyEsc}</Text>
            {' ' + LABELS.wordBack}
          </Text>
        </>
      )
    }

    if (isSearchOpen) {
      return (
        <>
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>{LABELS.keyEsc}</Text> {LABELS.wordClear}
          </Text>
          <Text color={COLORS.orange}>
            <Text bold>{LABELS.keyTab}</Text> {LABELS.hintDeepSearch.replace('tab ', '')}
          </Text>
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>{LABELS.keyUpDown}</Text> {LABELS.wordNav}
          </Text>
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>{LABELS.keyEnter}</Text> {LABELS.wordResume}
          </Text>
        </>
      )
    }

    if (isProjectActionMenuOpen || isSessionActionMenuOpen) {
      return (
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.keyUpDown}</Text>
          {' ' + LABELS.wordNav + '  '}
          <Text color={COLORS.text}>{LABELS.keyEnter}</Text>
          {' ' + LABELS.wordRun + '  '}
          <Text color={COLORS.text}>{LABELS.keyEsc}</Text>
          {' ' + LABELS.wordClose}
        </Text>
      )
    }

    if (bulkSelectedCount > 0) {
      return (
        <>
          <Text color={COLORS.warn}>
            {bulkSelectedCount} {LABELS.wordSelected}
          </Text>
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>{LABELS.keyArchive}</Text>
            {' ' + LABELS.wordArchive + '  '}
            <Text color={COLORS.text}>{LABELS.keyDelete}</Text>
            {' ' + LABELS.wordDelete + '  '}
            <Text color={COLORS.text}>{LABELS.keyEsc}</Text>
            {' ' + LABELS.wordClear}
          </Text>
        </>
      )
    }

    return (
      <>
        <Text color={COLORS.muted}>
          <Text color={COLORS.ok}>▶ {LABELS.keyEnter}</Text> {LABELS.wordResume}
        </Text>
        {focusedPanel === 'sessions' && !compact ? (
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>{LABELS.keyPreview}</Text> {LABELS.wordPreview}
          </Text>
        ) : null}
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.keyLeftRight}</Text> {LABELS.wordPanels}
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.keyUpDown}</Text> {LABELS.wordNav}
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.keyEsc}</Text> {LABELS.wordBack}
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.keySpace}</Text> {LABELS.wordActions}
        </Text>
        {!compact ? <Text color={COLORS.muted}>{LABELS.hintFocus}</Text> : null}
        {focusedPanel === 'sessions' && !compact ? (
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>{LABELS.keySelect}</Text> {LABELS.wordSelect}
          </Text>
        ) : null}
        {compact ? null : (
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>{LABELS.keyQuit}</Text> {LABELS.wordQuit}
          </Text>
        )}
        {compact ? null : (
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>{LABELS.keyCommandPalette}</Text> {LABELS.wordCommands}
          </Text>
        )}
      </>
    )
  }

  return (
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
      {renderHints()}
    </Box>
  )
}
