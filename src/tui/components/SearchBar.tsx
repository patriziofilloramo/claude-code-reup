import { Box, Text } from 'ink'

import { LABELS } from '../../config/labels.js'
import { COLORS } from '../../config/theme.js'

interface SearchBarProps {
  query: string
}

export default function SearchBar({ query }: SearchBarProps) {
  return (
    <Box gap={1}>
      <Text bold color={COLORS.accent}>
        /
      </Text>
      <Text color={COLORS.text}>{query}</Text>
      <Text color={COLORS.accent}>█</Text>
      {query.length === 0 && <Text color={COLORS.dim}>{LABELS.searchPlaceholder}</Text>}
    </Box>
  )
}
