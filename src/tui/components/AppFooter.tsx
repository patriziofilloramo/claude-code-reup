import { Box, Text, useStdout } from 'ink'

import { COLORS } from '../../config/theme.js'

interface AppFooterProps {
  bulkSelectedCount: number
  focusedPanel: 'projects' | 'sessions'
  isProjectActionMenuOpen: boolean
  isResumeCardOpen: boolean
  isSearchOpen: boolean
  isSessionActionMenuOpen: boolean
  statusMessage: string | null
}

export default function AppFooter({
  bulkSelectedCount,
  focusedPanel,
  isProjectActionMenuOpen,
  isResumeCardOpen,
  isSearchOpen,
  isSessionActionMenuOpen,
  statusMessage,
}: AppFooterProps) {
  const { stdout } = useStdout()
  const compact = (stdout?.columns ?? 80) < 100

  function renderHints() {
    if (statusMessage) {
      return <Text color={COLORS.warn}>{statusMessage}</Text>
    }

    if (isResumeCardOpen) {
      return (
        <>
          <Text>
            <Text color={COLORS.ok}>▶ enter</Text>
            <Text color={COLORS.muted}> resume session</Text>
          </Text>
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>f</Text>
            {' files  '}
            <Text color={COLORS.text}>esc</Text>
            {' back'}
          </Text>
        </>
      )
    }

    if (isSearchOpen) {
      return (
        <>
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>esc</Text> clear
          </Text>
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>tab</Text> deep search
          </Text>
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>↑↓</Text> nav
          </Text>
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>enter</Text> resume
          </Text>
        </>
      )
    }

    if (isProjectActionMenuOpen || isSessionActionMenuOpen) {
      return (
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>↑↓</Text>
          {' nav  '}
          <Text color={COLORS.text}>enter</Text>
          {' run  '}
          <Text color={COLORS.text}>esc</Text>
          {' close'}
        </Text>
      )
    }

    if (bulkSelectedCount > 0) {
      return (
        <>
          <Text color={COLORS.warn}>{bulkSelectedCount} selected</Text>
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>A</Text>
            {' archive  '}
            <Text color={COLORS.text}>esc</Text>
            {' clear'}
          </Text>
        </>
      )
    }

    return (
      <>
        <Text color={COLORS.muted}>
          <Text color={COLORS.ok}>▶ enter</Text> resume
        </Text>
        {focusedPanel === 'sessions' && !compact ? (
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>p</Text> preview
          </Text>
        ) : null}
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>← →</Text> panels
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>↑↓</Text> nav
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>esc</Text> back
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>space</Text> actions
        </Text>
        {focusedPanel === 'sessions' && !compact ? (
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>s</Text> select
          </Text>
        ) : null}
        {compact ? null : (
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>q</Text> quit
          </Text>
        )}
        {compact ? null : (
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>^K</Text> commands
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
