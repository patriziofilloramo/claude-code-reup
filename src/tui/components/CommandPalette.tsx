import { useState } from 'react'
import { Box, Text, useInput } from 'ink'

import { COLORS } from '../../config/theme.js'

export interface PaletteCommand {
  description: string
  key: string
  keybinding?: string
  visible?: boolean
}

interface CommandPaletteProps {
  commands: PaletteCommand[]
  onClose: () => void
  onExecute: (commandKey: string) => void
}

const PALETTE_WIDTH = 52

export default function CommandPalette({ commands, onClose, onExecute }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const visible = commands.filter((cmd) => cmd.visible !== false)
  const filtered = query
    ? visible.filter((cmd) => cmd.description.toLowerCase().includes(query.toLowerCase()))
    : visible

  const clampedIndex = Math.max(0, Math.min(selectedIndex, filtered.length - 1))

  useInput((input, key) => {
    const escapePressed = key.escape || input === '\x1b'
    if (escapePressed) {
      onClose()
      return
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1))
      return
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1))
      return
    }
    if (key.return) {
      const cmd = filtered[clampedIndex]
      if (cmd) onExecute(cmd.key)
      return
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1))
      setSelectedIndex(0)
      return
    }
    if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input)
      setSelectedIndex(0)
    }
  })

  const innerWidth = PALETTE_WIDTH - 4 // account for border + paddingX

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      <Box
        borderColor={COLORS.accent}
        borderStyle="round"
        flexDirection="column"
        paddingX={1}
        width={PALETTE_WIDTH}
      >
        <Box gap={1}>
          <Text color={COLORS.dim}>›</Text>
          {query ? (
            <Text color={COLORS.text}>{query}</Text>
          ) : (
            <Text color={COLORS.dim}>search commands…</Text>
          )}
        </Box>
        <Box>
          <Text color={COLORS.border}>{'─'.repeat(innerWidth)}</Text>
        </Box>
        {filtered.length === 0 ? (
          <Box paddingX={1}>
            <Text color={COLORS.dim}>no matching commands</Text>
          </Box>
        ) : (
          filtered.slice(0, 10).map((cmd, index) => {
            const isSelected = index === clampedIndex
            return (
              <Box key={cmd.key} gap={1}>
                <Text color={isSelected ? COLORS.accent : COLORS.border}>
                  {isSelected ? '▶' : ' '}
                </Text>
                <Box flexGrow={1}>
                  <Text bold={isSelected} color={isSelected ? COLORS.text : COLORS.textSub}>
                    {cmd.description}
                  </Text>
                </Box>
                {cmd.keybinding ? (
                  <Text color={COLORS.dim}>{cmd.keybinding}</Text>
                ) : null}
              </Box>
            )
          })
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>↑↓</Text>
          {' navigate  '}
          <Text color={COLORS.text}>enter</Text>
          {' run  '}
          <Text color={COLORS.text}>esc</Text>
          {' close'}
        </Text>
      </Box>
    </Box>
  )
}
