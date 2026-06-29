import { useState } from 'react'
import { Box, Text, useInput } from 'ink'

import { LABELS } from '../../config/labels.js'
import { COLORS } from '../../config/theme.js'
import { GROUP_LABELS, GROUP_ORDER } from '../commands.js'

export interface PaletteCommand {
  description: string
  key: string
  keybinding?: string
  visible?: boolean
  group?: string
}

interface CommandPaletteProps {
  commands: PaletteCommand[]
  onClose: () => void
  onExecute: (commandKey: string) => void
}

const PALETTE_WIDTH = 52

type DisplayItem =
  | { kind: 'header'; label: string; first: boolean }
  | { kind: 'command'; cmd: PaletteCommand; index: number }

export default function CommandPalette({ commands, onClose, onExecute }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const visible = commands.filter((cmd) => cmd.visible !== false)

  // Build displayItems (for rendering) and commandItems (for navigation/execution).
  const displayItems: DisplayItem[] = []
  const commandItems: PaletteCommand[] = []

  if (query) {
    // When filtering: flat list, no group headers.
    const matched = visible.filter((cmd) =>
      cmd.description.toLowerCase().includes(query.toLowerCase())
    )
    for (const cmd of matched) {
      displayItems.push({ kind: 'command', cmd, index: commandItems.length })
      commandItems.push(cmd)
    }
  } else {
    // Browsing: grouped view.
    let firstGroup = true
    for (const groupKey of GROUP_ORDER) {
      const groupCmds = visible.filter((c) => c.group === groupKey)
      if (groupCmds.length === 0) continue

      displayItems.push({ kind: 'header', label: GROUP_LABELS[groupKey], first: firstGroup })
      firstGroup = false

      for (const cmd of groupCmds) {
        displayItems.push({ kind: 'command', cmd, index: commandItems.length })
        commandItems.push(cmd)
      }
    }
    // Any command without a known group goes at the end, ungrouped.
    const ungrouped = visible.filter(
      (c) => !c.group || !(GROUP_ORDER as readonly string[]).includes(c.group)
    )
    for (const cmd of ungrouped) {
      displayItems.push({ kind: 'command', cmd, index: commandItems.length })
      commandItems.push(cmd)
    }
  }

  const clampedIndex = Math.max(0, Math.min(selectedIndex, commandItems.length - 1))

  useInput((input, key) => {
    if (key.escape || input === '\x1b') {
      onClose()
      return
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1))
      return
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(commandItems.length - 1, i + 1))
      return
    }

    if (key.return) {
      const cmd = commandItems[clampedIndex]
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

  const innerWidth = PALETTE_WIDTH - 4

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      <Box
        borderColor={COLORS.accent}
        borderStyle="round"
        flexDirection="column"
        paddingX={1}
        width={PALETTE_WIDTH}
      >
        {/* Search input */}
        <Box gap={1}>
          <Text color={COLORS.dim}>›</Text>
          {query ? (
            <Text color={COLORS.text}>{query}</Text>
          ) : (
            <Text color={COLORS.dim}>{LABELS.searchCommandsPlaceholder}</Text>
          )}
        </Box>

        <Box>
          <Text color={COLORS.border}>{'─'.repeat(innerWidth)}</Text>
        </Box>

        {/* Command list */}
        {commandItems.length === 0 ? (
          <Box paddingX={1}>
            <Text color={COLORS.dim}>{LABELS.noMatchingCommands}</Text>
          </Box>
        ) : (
          displayItems.slice(0, 16).map((item) =>
            item.kind === 'header' ? (
              <Box key={`h-${item.label}`} marginTop={item.first ? 0 : 1} paddingLeft={2}>
                <Text color={COLORS.dim}>{item.label}</Text>
              </Box>
            ) : (
              <Box key={item.cmd.key} gap={1}>
                <Text color={item.index === clampedIndex ? COLORS.accent : COLORS.border}>
                  {item.index === clampedIndex ? '▶' : ' '}
                </Text>
                <Box flexGrow={1}>
                  <Text
                    bold={item.index === clampedIndex}
                    color={item.index === clampedIndex ? COLORS.text : COLORS.textSub}
                  >
                    {item.cmd.description}
                  </Text>
                </Box>
                {item.cmd.keybinding ? <Text color={COLORS.dim}>{item.cmd.keybinding}</Text> : null}
              </Box>
            )
          )
        )}
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.keyUpDown}</Text>
          {' ' + LABELS.wordNav + '  '}
          <Text color={COLORS.text}>{LABELS.keyEnter}</Text>
          {' ' + LABELS.wordRun + '  '}
          <Text color={COLORS.text}>{LABELS.keyEsc}</Text>
          {' ' + LABELS.wordClose}
        </Text>
      </Box>
    </Box>
  )
}
