import { Box, Text, useInput, useStdout } from 'ink'

import { LABELS } from '../../config/labels.js'
import { COLORS } from '../../config/theme.js'
import { COMMANDS, GROUP_LABELS, GROUP_ORDER } from '../commands.js'
import type { CommandDef } from '../commands.js'
import { helpOverlayLayoutForWidth } from '../layout.js'

/** Compact help keeps only bindable commands; prose-only entries need the full card. */
export function commandsForHelpLayout(
  commands: readonly CommandDef[],
  compact: boolean
): readonly CommandDef[] {
  return compact ? commands.filter((command) => command.keybinding.trim() !== '') : commands
}

export default function HelpOverlay({ onClose }: { onClose: () => void }) {
  const { stdout } = useStdout()
  const layout = helpOverlayLayoutForWidth(stdout?.columns ?? 80)

  useInput((input, key) => {
    if (key.escape || input === '?' || input === 'q') onClose()
  })

  return (
    <Box flexDirection="column" paddingX={layout.outerPaddingX} paddingY={1}>
      <Box
        borderColor={COLORS.accent}
        borderStyle="round"
        flexDirection="column"
        paddingX={layout.panelPaddingX}
        paddingY={1}
        width={layout.panelWidth}
      >
        <Box marginBottom={1}>
          <Text bold color={COLORS.accent}>
            {LABELS.appName}
          </Text>
          <Text color={COLORS.muted}> {LABELS.keyboardShortcutsTitle}</Text>
        </Box>

        {GROUP_ORDER.map((group, gi) => {
          const cmds = commandsForHelpLayout(
            COMMANDS.filter((c) => c.group === group),
            layout.compact
          )
          if (cmds.length === 0) return null
          return (
            <Box flexDirection="column" key={group} marginTop={gi === 0 ? 0 : 1}>
              <Text color={COLORS.dim}>{GROUP_LABELS[group]}</Text>
              {cmds.map((cmd) => (
                <Box key={cmd.id}>
                  <Box flexShrink={0} width={layout.keyWidth}>
                    <Text color={COLORS.text}>{cmd.keybinding}</Text>
                  </Box>
                  <Box flexGrow={1} flexShrink={1} overflow="hidden">
                    <Text color={COLORS.textSub} wrap="truncate">
                      {cmd.label}
                    </Text>
                  </Box>
                </Box>
              ))}
            </Box>
          )
        })}
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.keyEsc} / ?</Text>
          {' ' + LABELS.wordClose}
        </Text>
      </Box>
    </Box>
  )
}
