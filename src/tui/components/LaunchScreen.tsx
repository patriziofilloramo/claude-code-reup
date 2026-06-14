import { Box, Text } from 'ink'

import { COLORS } from '../../config/theme.js'
import type { LaunchState } from '../App.js'
import AppHeader from './AppHeader.js'

interface LaunchScreenProps {
  launching: LaunchState
  spinnerFrame: string
  version: string
}

export default function LaunchScreen({ launching, spinnerFrame, version }: LaunchScreenProps) {
  const label =
    launching.kind === 'resume'
      ? `"${launching.session.alias ?? launching.session.name}"`
      : launching.projectPath.split(/[/\\]/).filter(Boolean).slice(-2).join('/')

  const verb = launching.kind === 'resume' ? 'launching' : 'starting new session in'

  return (
    <Box flexDirection="column">
      <AppHeader version={version} />
      <Box gap={1} paddingX={2} paddingY={1}>
        <Text color={COLORS.accent}>{spinnerFrame}</Text>
        <Text color={COLORS.muted}>{verb}</Text>
        <Text color={COLORS.text}>{label}</Text>
      </Box>
    </Box>
  )
}
