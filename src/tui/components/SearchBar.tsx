import { Box, Text } from 'ink'

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
      {query.length === 0 && <Text color={COLORS.dim}>e.g. fix auth, branch:main, is:active</Text>}
    </Box>
  )
}
