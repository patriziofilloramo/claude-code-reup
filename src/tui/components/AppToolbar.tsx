import { Box, Text, useStdout } from 'ink'

import { LABELS } from '../../config/labels.js'
import { COLORS } from '../../config/theme.js'
import { appToolbarLayoutForWidth } from '../layout.js'
import SearchBar from './SearchBar.js'

interface AppToolbarProps {
  focusLabel: string | null
  isLoading: boolean
  isSearchOpen: boolean
  projectCount: number
  searchQuery: string
}

export default function AppToolbar({
  focusLabel,
  isLoading,
  isSearchOpen,
  projectCount,
  searchQuery,
}: AppToolbarProps) {
  const { stdout } = useStdout()
  const layout = appToolbarLayoutForWidth(stdout?.columns ?? 80)

  return (
    <Box
      borderBottom={true}
      borderColor={COLORS.border}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      borderTop={false}
      gap={2}
      paddingX={1}
    >
      {isSearchOpen ? (
        <SearchBar query={searchQuery} />
      ) : (
        <Box gap={2}>
          <Text color={COLORS.dim}>
            {isLoading ? '…' : projectCount} {LABELS.wordProjects}
          </Text>
          {focusLabel ? (
            <Text color={COLORS.accent}>
              {LABELS.focusLabel} {focusLabel}
            </Text>
          ) : null}
          {layout.showNavigationHints ? (
            <Text color={COLORS.muted}>
              {'  '}
              <Text color={COLORS.text}>{LABELS.keySearch}</Text>
              {' ' + LABELS.wordSearch + '  '}
              <Text color={COLORS.text}>{LABELS.keyTab}</Text>
              {' ' + LABELS.wordSwitch}
            </Text>
          ) : null}
        </Box>
      )}
    </Box>
  )
}
