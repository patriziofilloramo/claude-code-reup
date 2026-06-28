import { Box, Text, useInput } from 'ink'

import { COLORS } from '../../config/theme.js'
import { COMMANDS, GROUP_LABELS, GROUP_ORDER } from '../commands.js'

const KEY_WIDTH = 14

export default function HelpOverlay({ onClose }: { onClose: () => void }) {
  useInput((input, key) => {
    if (key.escape || input === '?' || input === 'q') onClose()
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box
        borderColor={COLORS.accent}
        borderStyle="round"
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        width={60}
      >
        <Box marginBottom={1}>
          <Text bold color={COLORS.accent}>
            reup
          </Text>
          <Text color={COLORS.muted}> keyboard shortcuts</Text>
        </Box>

        {GROUP_ORDER.map((group, gi) => {
          const cmds = COMMANDS.filter((c) => c.group === group)
          if (cmds.length === 0) return null
          return (
            <Box flexDirection="column" key={group} marginTop={gi === 0 ? 0 : 1}>
              <Text color={COLORS.dim}>{GROUP_LABELS[group]}</Text>
              {cmds.map((cmd) => (
                <Box key={cmd.id}>
                  <Box width={KEY_WIDTH}>
                    <Text color={COLORS.text}>{cmd.keybinding}</Text>
                  </Box>
                  <Text color={COLORS.textSub}>{cmd.label}</Text>
                </Box>
              ))}
            </Box>
          )
        })}
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>esc / ?</Text>
          {' close'}
        </Text>
      </Box>
    </Box>
  )
}
